// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const AWS = require('aws-sdk');
// 5-second timeout for API calls
AWS.config.update({ httpOptions: { connectTimeout: 5000, timeout: 5000 } });
const cognitoISP = new AWS.CognitoIdentityServiceProvider(getOptions());
const sqs = new AWS.SQS(getOptions());
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

    if (Context && Context.State) {
        StateName = Context.State.Name;
        result.StateName = StateName;
    }

    result = { ...result, ... await updateNewUsers(context, newUserPoolId) };

    console.log(`Result: ${JSON.stringify(result)}`);
    return { result };
};

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
        const receiveMessageResult = await sqs.receiveMessage(receiveMessageParams).promise();

        if (receiveMessageResult.Messages && receiveMessageResult.Messages.length > 0) {
            console.log(`Read ${receiveMessageResult.Messages.length} message(s) off the queue`);
            output.QueueEmpty = false;
            const deleteMessageBatchParams = { QueueUrl: NEW_USERS_UPDATES_QUEUE_URL, Entries: [] };

            for (let i = 0; i < receiveMessageResult.Messages.length; i++) {
                const message = receiveMessageResult.Messages[i];
                const msgBody = JSON.parse(message.Body);
                let processed = false;
                let numAttempts = 1;

                while (!processed) {
                    try {
                        if (cognitoApiCallCount >= cognitoTPS) {
                            const waitTime = (oneSecondFromNow - currentTime) + 1;
                            console.log(`Cognito transactions per second limit (${cognitoTPS}) reached. Waiting for ${(oneSecondFromNow - currentTime)}ms before proceeding`);
                            await sleep(0, waitTime);
                        }

                        currentTime = new Date().getTime();
                        if (cognitoApiCallCount >= cognitoTPS || currentTime >= oneSecondFromNow) {
                            // Reset oneSecondFromNow and cognitoApiCallCount
                            console.log('Resetting Cognito TPS timer and API call count');
                            oneSecondFromNow = currentTime + 1000;
                            cognitoApiCallCount = 0;
                        }

                        cognitoApiCallCount++;
                        if (msgBody.type === TYPE_USER && !msgBody.userEnabled) {
                            await disableUser(msgBody.pseudoUsername, newUserPoolId);
                        } else {
                            await addUserToGroup(msgBody.groupPseudoUsername, msgBody.groupName, newUserPoolId);
                        }

                        deleteMessageBatchParams.Entries.push({ Id: message.MessageId, ReceiptHandle: message.ReceiptHandle });
                        processed = true;
                    } catch (err) {
                        console.error(err);

                        if (context.getRemainingTimeInMillis() > oneMinuteInMS && err.retryable) {
                            const sleepTimeInMs = getExponentialBackoffTimeInMS(100, numAttempts, oneMinuteInMS, true);
                            numAttempts++;
                            console.log(`Sleeping for ${sleepTimeInMs} milliseconds and will attempt to process the message again. That will be attempt #${numAttempts}`);
                            await sleep(0, sleepTimeInMs);
                        } else {
                            throw err;
                        }
                    }
                }
            }

            if (deleteMessageBatchParams.Entries.length > 0) {
                let batchDeleted = false;
                let numAttempts = 1;
                while (!batchDeleted) {
                    try {
                        console.log(`Deleting a batch of ${deleteMessageBatchParams.Entries.length} message(s) from the Update Queue`);
                        await sqs.deleteMessageBatch(deleteMessageBatchParams).promise();
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
    await cognitoISP.adminDisableUser(params).promise();
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
    await cognitoISP.adminAddUserToGroup(addUserToGroupParams).promise();
    console.log('User added to group');
};
