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
        DynamoDBDocumentClient, PutCommand
      } = require("@aws-sdk/lib-dynamodb");
const { BACKUP_TABLE_NAME, AWS_REGION, TYPE_GROUP } = process.env;

/**
 * Exports the supplied group name to the backup table
 * @param {object} event
 */
exports.handler = async (event) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const { groupName, groupDescription, groupPrecedence, groupLastModifiedDate, exportTimestamp } = event;

    await exportGroupName(groupName, groupDescription, groupPrecedence, groupLastModifiedDate, exportTimestamp);
    const output = {
        exportTimestamp: exportTimestamp,
        groupName: groupName,
        UsernameAttributes: event.UsernameAttributes
    };
    console.log(`Output: ${JSON.stringify(output)}`);
    return output;
};

/**
 * Puts/updates an item in the backup table for the supplied group that was found in the user pool during the latest export
 * @param {string} groupName The name of the group
 * @param {string} groupDescription The description of the group
 * @param {number} groupPrecedence The precedence of the group
 * @param {string} groupLastModifiedDate The ISO timestamp for when the group was last modified
 * @param {number} exportTimestamp The timestamp for the latest export
 */
const exportGroupName = async function exportGroupNameToBackupTable(groupName, groupDescription, groupPrecedence, groupLastModifiedDate, exportTimestamp) {
    const dynamodbClient = new DynamoDBClient(getOptions());
    const docClient = DynamoDBDocumentClient.from(dynamodbClient);
    const putParams = {
        TableName: BACKUP_TABLE_NAME,
        Item: {
            id: `GROUP-${groupName}`,
            type: TYPE_GROUP,
            groupName,
            groupDescription,
            groupPrecedence,
            groupLastModifiedDate,
            lastConfirmedInUserPool: exportTimestamp,
            lastUpdatedRegion: AWS_REGION
        }
    };

    console.log(`Putting group in table: ${JSON.stringify(putParams)}`);
    await docClient.send(new PutCommand(putParams));
    console.log('Group put successfully');
};
