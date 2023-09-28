// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
        DynamoDBClient
      } = require("@aws-sdk/client-dynamodb"),
      {
          SQS
      } = require("@aws-sdk/client-sqs"),
      { 
        DynamoDBDocumentClient, BatchWriteCommand, ScanCommand
      } = require("@aws-sdk/lib-dynamodb");
const dynamodbClient = new DynamoDBClient(getOptions());
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const sqs = new SQS(getOptions());
const uuid = require('uuid');
const { BACKUP_TABLE_NAME, QUEUE_URL } = process.env;
const oneMinuteInMS = 60 * 1000;
const { sleep } = require('../utils/helper-functions');

/**
 * Cleans up the Backup Table by identifying items that were not updated during the most recent export and removing them
 * @param {object} event 
 */
exports.handler = async (event, lambdaContext) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const { Context, Input } = event;
    const result = { ExportTimestamp: Input.ExportTimestamp, NumItemsAddedToQueue: (Input.NumItemsAddedToQueue || 0) };

    switch (Context.State.Name) {
        case 'BackupTableCleanup: Find Items':
            const findItemsResult = await findItemsToCleanup(Input, lambdaContext);
            if (findItemsResult.lastEvaluatedKey) {
                result.lastEvaluatedKey = findItemsResult.lastEvaluatedKey;
            } else {
                // Empty string will make us exit the loop in the step function workflow
                result.lastEvaluatedKey = '';
            }

            result.NumItemsAddedToQueue += findItemsResult.numItemsAddedToQueue;
            break;
        case 'BackupTableCleanup: Remove Items':
            result.IsQueueEmpty = await readMessagesInQueue(lambdaContext);
            break;
        default:
            console.log(`Unknown State Name: ${Context.State.Name}`);
            break;
    }

    return { result };
};

/**
 * Scans the backup table and identifies items for which the 'lastConfirmedInUserPool' was not updated
 * @param {object} Input Lambda input
 * @param {object} lambdaContext Lambda context object
 */
const findItemsToCleanup = async (Input, lambdaContext) => {
    let numItemsAddedToQueue = 0;
    const scanParams = {
        TableName: BACKUP_TABLE_NAME,
        FilterExpression: 'attribute_exists(lastConfirmedInUserPool) and lastConfirmedInUserPool < :ts',
        ProjectionExpression: 'id,#type',
        ExpressionAttributeValues: {
            ':ts': Input.ExportTimestamp
        },
        ExpressionAttributeNames: {
            '#type': 'type'
        }
    };

    if (Input.lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = Input.lastEvaluatedKey;
    }

    do {
        console.log('Scanning table...');
        const scanResponse = await docClient.send(new ScanCommand(scanParams));
        console.log(`Retrieved ${scanResponse.Count} item(s). Scanned ${scanResponse.ScannedCount} item(s)`);

        if (scanResponse.Count > 0) {
            await sendItemsToQueue(scanResponse.Items);
            numItemsAddedToQueue += scanResponse.Count;
        }

        // Check if there are additional items in the backup table to scan
        delete scanParams.ExclusiveStartKey;
        if (scanResponse.LastEvaluatedKey) {
            scanParams.ExclusiveStartKey = scanResponse.LastEvaluatedKey;
        }
    } while (lambdaContext.getRemainingTimeInMillis() > oneMinuteInMS && scanParams.ExclusiveStartKey);

    return { lastEvaluatedKey: scanParams.ExclusiveStartKey, numItemsAddedToQueue };
};

/**
 * Adds the array of items to the export workflow queue so they can be removed
 * @param {object[]} items Array of items to be removed from the backup table
 */
const sendItemsToQueue = async (items) => {
    while (items.length > 0) {
        const sendMessageBatchParams = {
            QueueUrl: QUEUE_URL,
            Entries: items.splice(0, 10).map(item => {
                return {
                    Id: uuid.v4(),
                    MessageBody: JSON.stringify({ Action: 'DELETE', Key: item })
                };
            })
        };

        console.log(`Adding batch of ${sendMessageBatchParams.Entries.length} message(s) to the Export Workflow queue`);
        await sqs.sendMessageBatch(sendMessageBatchParams);
        console.log('Message(s) added to the Export Workflow queue');
    }
};

/**
 * Reads messages off the export workflow queue
 * @param {object} lambdaContext Lambda context object
 */
const readMessagesInQueue = async (lambdaContext) => {
    let queueEmpty = false;
    let numEmptyResponses = 0;
    const receiveMessageParams = {
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5
    };

    do {
        console.log(`Receiving messages from queue: ${JSON.stringify(receiveMessageParams)}`);
        const response = await sqs.receiveMessage(receiveMessageParams);
        if (response.Messages && response.Messages.length > 0) {
            numEmptyResponses = 0;
            console.log(`Received ${response.Messages.length} message(s)`);
            await removeItemsFromBackupTable(response.Messages);
        } else {
            console.log('Received 0 messages');
            numEmptyResponses++;
            if (numEmptyResponses >= 5) {
                queueEmpty = true;
            } else {
                await sleep(1);
            }
        }
    } while (lambdaContext.getRemainingTimeInMillis() > oneMinuteInMS && !queueEmpty);

    return queueEmpty;
};

/**
 * Removes items from the backup table
 * @param {object[]} messages An array of messages that were read off the export table queue
 */
const removeItemsFromBackupTable = async (messages) => {
    const batchWriteParams = {
        RequestItems: {
            [BACKUP_TABLE_NAME]: messages.map(msg => {
                const msgBody = JSON.parse(msg.Body);
                return {
                    DeleteRequest: {
                        Key: msgBody.Key
                    }
                };
            })
        }
    };

    let resp;
    do {
        console.log(`Going to delete ${batchWriteParams.RequestItems[BACKUP_TABLE_NAME].length} records(s) from ${BACKUP_TABLE_NAME}`);
        resp = await docClient.send(new BatchWriteCommand(batchWriteParams));
        if (resp.UnprocessedItems[BACKUP_TABLE_NAME] !== undefined && resp.UnprocessedItems[BACKUP_TABLE_NAME].length > 0) {
            console.log(`Detected ${resp.UnprocessedItems[BACKUP_TABLE_NAME].length} unprocessed item(s). Waiting 100 ms then processing again`);
            batchWriteParams.RequestItems[BACKUP_TABLE_NAME] = resp.UnprocessedItems[BACKUP_TABLE_NAME];
            await sleep(0, 100, false);
        }
    } while (resp.UnprocessedItems[BACKUP_TABLE_NAME] !== undefined && resp.UnprocessedItems[BACKUP_TABLE_NAME].length > 0);

    console.log('Item(s) removed from the backup table');

    await deleteMessagesFromQueue(messages);
};

/**
 * Removes messages from the export workflow queue
 * @param {object[]} messages An array of messages to remove from the queue
 */
const deleteMessagesFromQueue = async (messages) => {
    const deleteMessageBatchParams = { QueueUrl: QUEUE_URL };
    deleteMessageBatchParams.Entries = messages.map(msg => {
        return {
            Id: msg.MessageId,
            ReceiptHandle: msg.ReceiptHandle
        };
    });

    console.log(`Deleting a batch of ${deleteMessageBatchParams.Entries.length} message(s) from the queue`);
    await sqs.deleteMessageBatch(deleteMessageBatchParams);
    console.log('Message batch deleted');
};
