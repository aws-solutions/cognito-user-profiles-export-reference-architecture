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
        DynamoDBClient
      } = require("@aws-sdk/client-dynamodb"),
      {
          SQS
      } = require("@aws-sdk/client-sqs"),
      { 
        DynamoDBDocumentClient, ScanCommand 
      } = require("@aws-sdk/lib-dynamodb");

const dynamodbClient = new DynamoDBClient(getOptions());
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const cognitoISP = new CognitoIdentityServiceProvider(getOptions());
const sqs = new SQS(getOptions());
const { sleep } = require('../utils/helper-functions');
const { BACKUP_TABLE_NAME, TYPE_GROUP, TYPE_USER, COGNITO_TPS,
    TYPE_TIMESTAMP, NEW_USERS_QUEUE_URL, NEW_USERS_UPDATES_QUEUE_URL } = process.env;
const uuid = require('uuid');
const ONE_MINUTE = 1000 * 60;

function filterMessage(msg){
    if (msg.type === TYPE_TIMESTAMP) {
        return false;
    } else if (msg.type !== TYPE_USER && msg.type !== TYPE_GROUP) {
        // This is a group membership record
        return true;
    } else if (msg.type === TYPE_USER && !msg.userEnabled) {
        // This user is not enabled in the user pool
        return true;
    }
    return false;
}

async function doWait(groupMessages, cognitoApiCallCount, cognitoTPS, currentTime, oneSecondFromNow){
    if (groupMessages.length > 0 && (cognitoApiCallCount >= cognitoTPS) && (currentTime < oneSecondFromNow)) {
        const waitTime = (oneSecondFromNow - currentTime);
        console.log(`Cognito transactions per second limit (${cognitoTPS}) reached. Waiting for ${(oneSecondFromNow - currentTime)}ms before proceeding`);
        await sleep(0, waitTime);
    }
}

function checkAllProcessed(scanResponse, result){
    if (scanResponse.LastEvaluatedKey) {
        result.LastEvaluatedKey = scanResponse.LastEvaluatedKey;
        result.AllGroupsProcessed = 'No';
    } else {
        result.AllGroupsProcessed = 'Yes';
    }
}


async function processNewUserQueue(scanResponse, cognitoTPS, newUserPoolId){
    console.log(`Found ${scanResponse.Items.length} item(s)`);

    // Send user messages to the New User Queue
    await sendMessagesToQueue(scanResponse.Items.filter(msg => msg.type === TYPE_USER), NEW_USERS_QUEUE_URL);

    // Send group membership or deactivated user messages to the New User Updates Queue
    await sendMessagesToQueue(
        scanResponse.Items.filter(msg => filterMessage(msg)),
        NEW_USERS_UPDATES_QUEUE_URL);

    const groupMessages = scanResponse.Items.filter(msg => msg.type === TYPE_GROUP);

    while (groupMessages.length > 0) {
        let cognitoApiCallCount = 0;
        let currentTime = new Date().getTime();
        const oneSecondFromNow = currentTime + 1000;

        while (groupMessages.length > 0 && (cognitoApiCallCount < cognitoTPS) && (currentTime < oneSecondFromNow)) {
            const group = groupMessages.splice(0, 1)[0];
            const { groupName, groupDescription, groupPrecedence } = group;
            await addGroup(groupName, groupDescription, groupPrecedence, newUserPoolId);
            cognitoApiCallCount++;

            currentTime = new Date().getTime();
        }

        await doWait(groupMessages, cognitoApiCallCount, cognitoTPS, currentTime, oneSecondFromNow);
    }

}
/**
 * Scans the backup table and queues items for the Import Workflow 
 * @param {object} event Lambda event payload
 * @param {object} context Lambda Context 
 */
exports.handler = async (event, context) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const cognitoTPS = parseInt(COGNITO_TPS, 10);
    if (isNaN(cognitoTPS)) {
        throw new Error(`Unable to parse a number from the COGNITO_TPS value (${COGNITO_TPS})`);
    }

    let newUserPoolId;
    try {
        const { Context } = event;
        newUserPoolId = Context.Execution.Input.NewUserPoolId.trim();
        if (!newUserPoolId) {
            throw new Error('Unable to determine the new user pool ID');
        }
    } catch (err) {
        console.error(err);
        throw new Error('Unable to determine the new user pool ID');
    }

    const result = {};

    const scanParams = {
        TableName: BACKUP_TABLE_NAME
    };

    if (event.Input.LastEvaluatedKey) {
        scanParams.ExclusiveStartKey = event.Input.LastEvaluatedKey;
    }
    let scanResponse;

    do {
        console.log(`Scanning: ${JSON.stringify(scanParams)}`);
        scanResponse = await docClient.send(new ScanCommand(scanParams));
        if (scanResponse.Items?.length > 0) {
            await processNewUserQueue(scanResponse, cognitoTPS, newUserPoolId);

        } else {
            console.log('No items found');
        }

        // Check if there are more items to read from the Backup Table
        delete scanParams.ExclusiveStartKey;
        if (scanResponse.LastEvaluatedKey) {
            scanParams.ExclusiveStartKey = scanResponse.LastEvaluatedKey;
        }
    } while (scanParams.ExclusiveStartKey && context.getRemainingTimeInMillis() > ONE_MINUTE);

    checkAllProcessed(scanResponse, result);

    console.log(`Result: ${JSON.stringify(result)}`);
    return { result: result };
};

/**
 * Adds a group to the new user pool
 * @param {string} groupName Group Name
 * @param {string} groupDescription Group Description
 * @param {number} groupPrecedence Group Precedence
 * @param {string} newUserPoolId The ID of the import user pool
 */
const addGroup = async (groupName, groupDescription, groupPrecedence, newUserPoolId) => {
    const createGroupParams = { UserPoolId: newUserPoolId, GroupName: groupName, Description: groupDescription };
    if (groupPrecedence >= 0) {
        createGroupParams.Precedence = groupPrecedence;
    }

    console.log(`Creating group: ${JSON.stringify(createGroupParams)}`);
    const response = await cognitoISP.createGroup(createGroupParams);
    console.log(`Create group response: ${JSON.stringify(response)}`);
};

/**
 * Sends messages to the supplied queue so they can be processed by further steps of the Import Workflow
 * @param {object[]} messages An array of messages to send to the queue
 * @param {string} queueUrl The URL of the queue to which the messages will be sent
 */
const sendMessagesToQueue = async (messages, queueUrl) => {
    if (messages.length > 0) {
        console.log(`Found ${messages.length} ${queueUrl === NEW_USERS_QUEUE_URL ? 'new user' : 'update (i.e. group membership)'} message(s) to add to the queue`);

        while (messages.length > 0) {
            const sendMessageBatchParams = {
                QueueUrl: queueUrl,
                Entries: messages.splice(0, 10).map(msg => {
                    return {
                        Id: uuid.v4(),
                        MessageBody: JSON.stringify(msg)
                    };
                })
            };

            console.log(`Adding batch of ${sendMessageBatchParams.Entries.length} message(s) to the New User queue`);
            await sqs.sendMessageBatch(sendMessageBatchParams);
            console.log('Message(s) added to the New User queue');
        }
    }
};
