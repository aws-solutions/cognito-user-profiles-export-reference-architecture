// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const AWS = require('aws-sdk');
const cognitoISP = new AWS.CognitoIdentityServiceProvider(getOptions());
const docClient = new AWS.DynamoDB.DocumentClient(getOptions());
const ONE_MINUTE = 60000;
const { sleep, getExponentialBackoffTimeInMS } = require('../utils/helper-functions');
const { COGNITO_TPS, USER_POOL_ID, BACKUP_TABLE_NAME, AWS_REGION } = process.env;
let poolUsernameAttributes = [];

/**
 * Exports users in the supplied group name to the backup table
 * @param {object} event 
 */
exports.handler = async (event, context) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const cognitoTPS = parseInt(COGNITO_TPS, 10);
    if (isNaN(cognitoTPS)) {
        throw new Error(`Unable to parse a number from the COGNITO_TPS value (${COGNITO_TPS})`);
    }

    const { groupName, exportTimestamp } = event;
    let { listUsersInGroupNextToken } = event;
    let usersProcessed = 0;

    let listUsersInGroupParams = {
        UserPoolId: USER_POOL_ID,
        GroupName: groupName
    };

    if (listUsersInGroupNextToken) {
        listUsersInGroupParams.NextToken = listUsersInGroupNextToken;
    }

    if (event.UsernameAttributes) {
        poolUsernameAttributes = JSON.parse(event.UsernameAttributes);
    }

    do {
        let cognitoApiCallCount = 0;
        let currentTime = new Date().getTime();
        const oneSecondFromNow = currentTime + 1000;

        do {
            let numAttempts = 1;

            try {
                console.log(`Listing users in group: ${JSON.stringify(listUsersInGroupParams)}`);
                const response = await cognitoISP.listUsersInGroup(listUsersInGroupParams).promise();
                cognitoApiCallCount++;

                if (response.Users && response.Users.length > 0) {
                    const nonExternalUsers = response.Users.filter(user => user.UserStatus !== 'EXTERNAL_PROVIDER');

                    if (nonExternalUsers.length > 0) {
                        const numUsersReturned = nonExternalUsers.length;
                        console.log(`Number of users returned: ${numUsersReturned}`);
                        await exportGroupMembers(groupName, nonExternalUsers, exportTimestamp);
                        usersProcessed += numUsersReturned;
                    } else {
                        console.log('No users were returned');
                    }
                } else {
                    console.log('No users were returned');
                }

                // Check to see if there are more users to fetch
                response.NextToken ? listUsersInGroupParams.NextToken = response.NextToken : delete listUsersInGroupParams.NextToken;

                currentTime = new Date().getTime();
            } catch (err) {
                console.error(err);
                if (context.getRemainingTimeInMillis() > ONE_MINUTE && err.retryable) {
                    const sleepTimeInMs = getExponentialBackoffTimeInMS(100, numAttempts, ONE_MINUTE, false);
                    numAttempts++;
                    console.log(`Sleeping for ${sleepTimeInMs} milliseconds and will list users again. That will be attempt #${numAttempts}`);
                    await sleep(0, sleepTimeInMs);
                } else {
                    throw err;
                }
            }
        } while (listUsersInGroupParams.NextToken && (cognitoApiCallCount < cognitoTPS) && (currentTime < oneSecondFromNow) && (context.getRemainingTimeInMillis() > ONE_MINUTE));

        if (listUsersInGroupParams.NextToken && (cognitoApiCallCount >= cognitoTPS) && (currentTime < oneSecondFromNow)) {
            const waitTime = (oneSecondFromNow - currentTime);
            console.log(`Cognito transactions per second limit (${cognitoTPS}) reached. Waiting for ${(oneSecondFromNow - currentTime)}ms before proceeding`);
            await sleep(0, waitTime);
        }
    } while (listUsersInGroupParams.NextToken && context.getRemainingTimeInMillis() > ONE_MINUTE);

    const output = { exportTimestamp: exportTimestamp, groupName: groupName, listUsersInGroupNextToken: listUsersInGroupParams.NextToken };
    output.listUsersInGroupNextToken ? output.processedAllUsersInGroup = 'No' : output.processedAllUsersInGroup = 'Yes';
    console.log(`Number of users processed total: ${usersProcessed}`);
    console.log(`Output: ${JSON.stringify(output)}`);
    return output;
};

/**
 * Puts/updates group membership records for the users in the supplied array
 * @param {string} groupName The name of the group the users are in
 * @param {object[]} users An array of user objects that are members of the supplied group
 * @param {number} latestTimestamp The timestamp for the latest export
 */
const exportGroupMembers = async function syncUsersToGroupsTable(groupName, users, latestTimestamp) {
    const batchWriteMax = 25;
    while (users.length > 0) {
        const batchWriteParams = {
            RequestItems: {}
        };

        batchWriteParams.RequestItems[BACKUP_TABLE_NAME] = users.splice(0, batchWriteMax).map(user => {
            let subValue;
            const subAttribute = user.Attributes.find(attr => attr.Name === 'sub');
            if (subAttribute) {
                subValue = subAttribute.Value;
            }

            if (!subValue) {
                throw new Error('Unable to determine the sub attribute for user');
            }

            // The pseudoUsername  will be used as the username for the user import
            // CSV when importing users during the import workflow
            let pseudoUsername;
            if (poolUsernameAttributes.length === 0) {
                pseudoUsername = user.Username;
            } else if (poolUsernameAttributes.length === 1) {
                const pseudoUsernameAttribute = user.Attributes.find(attr => attr.Name === poolUsernameAttributes[0]);
                pseudoUsername = pseudoUsernameAttribute.Value;
            } else {
                // Narrow down which attribute to use as pseudoUsername
                const possibleAttributes = user.Attributes.filter(attr => poolUsernameAttributes.includes(attr.Name) && attr.Value.trim() !== '');
                if (possibleAttributes.length === 1) {
                    pseudoUsername = possibleAttributes[0].Value;
                }
            }

            if (!pseudoUsername) {
                throw new Error('Unable to determine the pseudoUsername for the user');
            }

            return {
                PutRequest: {
                    Item: {
                        id: `GROUP_MEMBER-${groupName}`,
                        type: `GROUP_MEMBER-${subValue}`,
                        groupUser: user.Username,
                        groupPseudoUsername: pseudoUsername,
                        groupName: groupName,
                        lastConfirmedInUserPool: latestTimestamp,
                        lastUpdatedRegion: AWS_REGION
                    }
                }
            };
        });

        let response;
        do {
            console.log(`Writing ${batchWriteParams.RequestItems[BACKUP_TABLE_NAME].length} user(s)`);
            response = await docClient.batchWrite(batchWriteParams).promise();

            if (response.UnprocessedItems[BACKUP_TABLE_NAME] !== undefined && response.UnprocessedItems[BACKUP_TABLE_NAME].length > 0) {
                console.log(`Detected ${response.UnprocessedItems[BACKUP_TABLE_NAME].length} unprocessed item(s). Waiting 100 ms then processing again`);
                batchWriteParams.RequestItems[BACKUP_TABLE_NAME] = response.UnprocessedItems[BACKUP_TABLE_NAME];
                await sleep(0, 100, false);
            }
        } while (response.UnprocessedItems[BACKUP_TABLE_NAME] !== undefined && response.UnprocessedItems[BACKUP_TABLE_NAME].length > 0);
        console.log('Users written');
    }
};
