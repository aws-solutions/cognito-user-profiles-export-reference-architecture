// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
          CognitoIdentityProvider: CognitoIdentityServiceProvider
      } = require("@aws-sdk/client-cognito-identity-provider"),
      {
          SQS
      } = require("@aws-sdk/client-sqs"),
      { NodeHttpHandler } = require("@aws-sdk/node-http-handler");
// 5-second timeout for API calls
const requestHandler = new NodeHttpHandler({connectionTimeout: 5000, socketTimeout: 5000});
const cognitoISP = new CognitoIdentityServiceProvider(getOptions(), requestHandler);
const sqs = new SQS(getOptions(), requestHandler);
const { COGNITO_TPS, NEW_USERS_UPDATES_QUEUE_URL, TYPE_USER } = process.env;
const { sleep, getExponentialBackoffTimeInMS } = require('../utils/helper-functions');
const oneMinuteInMS = 1000 * 60;

/**
 * Updates users that have been imported to the new user pool
 * @param {object} event 
 */
exports.handler = async (event, context) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const { Context, Input } = event;
    let result = { ...Input };
    let StateName = '';
    let newUserPoolId;
    try {
        newUserPoolId = Context.Execution.Input.NewUserPoolId.trim();
        if (!newUserPoolId) {
            throw new Error('Unable to determine the new user pool ID');
        }
    } catch (err) {
        console.error(err);
        throw new Error('Unable to determine the new user pool ID');
    }

    if (Context?.State) {
        StateName = Context.State.Name;
        result.StateName = StateName;
    }

    result = { ...result, ... (await updateNewUsers(context, newUserPoolId)) };

    console.log(`Result: ${JSON.stringify(result)}`);
    return { result };
};

async function deleteMessages(deleteMessageBatchParams){
    if (deleteMessageBatchParams.Entries.length > 0) {
        let batchDeleted = false;
        let numAttempts = 1;
        while (!batchDeleted) {
            try {
                console.log(`Deleting a batch of ${deleteMessageBatchParams.Entries.length} message(s) from the Update Queue`);
                await sqs.deleteMessageBatch(deleteMessageBatchParams);
                console.log('Message batch deleted');
                batchDeleted = true;
            } catch (err) {
                console.error(err);
                if (err.retryable) {
                    const sleepTimeInMs = getExponentialBackoffTimeInMS(50, numAttempts, 1000, false);
                    numAttempts++;
                    console.log(`Sleeping for ${sleepTimeInMs} milliseconds and will attempt to delete the batch again. That will be attempt #${numAttempts}`);
                    await sleep(0, sleepTimeInMs);
                } else {
                    throw err;
                }
            }
        }
    }
}

async function checkCallCount(cognitoApiCallCount, cognitoTPS, oneSecondFromNow, currentTime){
    if (cognitoApiCallCount >= cognitoTPS) {
        const waitTime = (oneSecondFromNow - currentTime) + 1;
        console.log(`Cognito transactions per second limit (${cognitoTPS}) reached. Waiting for ${(oneSecondFromNow - currentTime)}ms before proceeding`);
        await sleep(0, waitTime);
    }
}

async function disableOrAddUser(msgBody, newUserPoolId){
    console.log('disableOrAddUser groupName', msgBody.groupName)
    if (msgBody.type === TYPE_USER && !msgBody.userEnabled) {
        await disableUser(msgBody.pseudoUsername, newUserPoolId);
    } else {
        await addUserToGroup(msgBody.groupPseudoUsername, msgBody.groupName, newUserPoolId);
    }
}
async function exponentialBackoff(context, numAttemptsWrapper, err){
    if (context.getRemainingTimeInMillis() > oneMinuteInMS && err.retryable) {
        const sleepTimeInMs = getExponentialBackoffTimeInMS(100, numAttemptsWrapper.numAttempts, oneMinuteInMS, true);
        numAttemptsWrapper.numAttempts++;
        console.log(`Sleeping for ${sleepTimeInMs} milliseconds and will attempt to process the message again. That will be attempt #${numAttemptsWrapper.numAttempts}`);
        await sleep(0, sleepTimeInMs);
    } else {
        throw err;
    }
}

function resetCallCount(paramWrapper) {
    if (paramWrapper.cognitoApiCallCount >= paramWrapper.cognitoTPS || paramWrapper.currentTime >= paramWrapper.oneSecondFromNow) {
        // Reset oneSecondFromNow and cognitoApiCallCount
        paramWrapper.oneSecondFromNow = paramWrapper.currentTime + 1000;
        paramWrapper.cognitoApiCallCount = 0;
    }
}

async function processLoops(paramWrapper, msgBody, newUserPoolId, message, context, cognitoTPS, deleteMessageBatchParams){
    while (!paramWrapper.processed) {
        try {

            await checkCallCount(paramWrapper.cognitoApiCallCount, cognitoTPS, paramWrapper.oneSecondFromNow, paramWrapper.currentTime);

            paramWrapper.currentTime = new Date().getTime();

            resetCallCount(paramWrapper);

            paramWrapper.cognitoApiCallCount++;

            await disableOrAddUser(msgBody, newUserPoolId);

            deleteMessageBatchParams.Entries.push({ Id: message.MessageId, ReceiptHandle: message.ReceiptHandle });
            paramWrapper.processed = true;
        } catch (err) {
            console.error(err);

            let numAttemptsWrapper = {numAttempts: paramWrapper.numAttempts};
            await exponentialBackoff(context, numAttemptsWrapper, err);
            paramWrapper.numAttempts = numAttemptsWrapper.numAttempts;
        }
    }
}
/**
 * Reads messages off the New Users Updates queue and applies any updates (i.e. add to group or disable the user)
 * @param {object} context Lambda context
 * @param {string} newUserPoolId The ID of the import user pool
 */
const updateNewUsers = async (context, newUserPoolId) => {
    const cognitoTPS = parseInt(COGNITO_TPS, 10);

    if (isNaN(cognitoTPS)) {
        throw new Error(`Unable to parse a number from the COGNITO_TPS value (${COGNITO_TPS})`);
    }

    const output = { QueueEmpty: true };
    let cognitoApiCallCount = 0;
    let currentTime = new Date().getTime();
    let oneSecondFromNow = currentTime + 1000;
    do {
        const receiveMessageParams = { QueueUrl: NEW_USERS_UPDATES_QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 3 };
        console.log(`Getting messages off Update Queue: ${JSON.stringify(receiveMessageParams)}`);
        const receiveMessageResult = await sqs.receiveMessage(receiveMessageParams);

        if (receiveMessageResult.Messages?.length > 0) {

            console.log(`Read ${receiveMessageResult.Messages.length} message(s) off the queue`);
            output.QueueEmpty = false;
            const deleteMessageBatchParams = { QueueUrl: NEW_USERS_UPDATES_QUEUE_URL, Entries: [] };

            for (const message of receiveMessageResult.Messages) {
                const msgBody = JSON.parse(message.Body);
                let processed = false;
                let numAttempts = 1;

                let paramWrapper = {
                    processed: processed,
                    oneSecondFromNow: oneSecondFromNow,
                    cognitoApiCallCount: cognitoApiCallCount,
                    currentTime: currentTime,
                    numAttempts: numAttempts,
                    cognitoTPS: cognitoTPS
                };

                await processLoops(paramWrapper, msgBody, newUserPoolId, message, context, cognitoTPS, deleteMessageBatchParams);

                processed = paramWrapper.processed;
                oneSecondFromNow = paramWrapper.oneSecondFromNow;
                cognitoApiCallCount = paramWrapper.cognitoApiCallCount;
                currentTime = paramWrapper.currentTime;
                numAttempts = paramWrapper.numAttempts;

            }
            await deleteMessages(deleteMessageBatchParams);
        } else {
            console.log('No messages in queue');
            output.QueueEmpty = true;
        }
    } while (!output.QueueEmpty && context.getRemainingTimeInMillis() > oneMinuteInMS);

    return output;
};

/**
 * Disables a user in the primary user pool
 * @param {string} username User name
 * @param {string} newUserPoolId The ID of the import user pool
 */
const disableUser = async (username, newUserPoolId) => {
    const params = { UserPoolId: newUserPoolId, Username: username };
    console.log('Disabling user...');
    await cognitoISP.adminDisableUser(params);
    console.log('User disabled');
};

/**
 * Adds the user to the supplied group
 * @param {string} username Username for the user
 * @param {string} groupName Name of the group
 * @param {string} newUserPoolId The ID of the import user pool
 */
const addUserToGroup = async (username, groupName, newUserPoolId) => {
    const addUserToGroupParams = { UserPoolId: newUserPoolId, GroupName: groupName, Username: username };
    console.log(`Adding user to group (${groupName})`);
    await cognitoISP.adminAddUserToGroup(addUserToGroupParams);
    console.log('User added to group');
};
