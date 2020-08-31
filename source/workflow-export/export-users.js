// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const AWS = require('aws-sdk');
const DynamoDB = require('aws-sdk/clients/dynamodb');
const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider();
const documentClient = new DynamoDB.DocumentClient();

const { AWS_REGION, USER_POOL_ID, TABLE_NAME, COGNITO_TPS, TYPE_USER } = process.env;
const ONE_MINUTE = 60 * 1000;
const { sleep, getExponentialBackoffTimeInMS } = require('../utils/helper-functions');
let poolUsernameAttributes = [];

/**
 * Exports user profiles to the backup table
 * @return {Promise<{ paginationToken: string, ExportTimestamp: number }>}
 */
exports.handler = async (event, context) => {
  console.log(`Requested event: ${JSON.stringify(event, null, 2)}`);
  const cognitoTPS = parseInt(COGNITO_TPS, 10);
  if (isNaN(cognitoTPS)) {
    throw new Error(`Unable to parse a number from the COGNITO_TPS value (${COGNITO_TPS})`);
  }

  const output = {
    paginationToken: '',
    UsernameAttributes: event.UsernameAttributes,
    ExportTimestamp: -1
  };

  if (event.paginationToken) {
    // This function was invoked a subsequent time within an execution of the ExportWorkflow
    // Retrieve the ExportTimestamp from the event instead of creating a new value
    output.paginationToken = event.paginationToken;
    output.ExportTimestamp = event.ExportTimestamp;
  } else {
    output.ExportTimestamp = new Date().getTime();
  }

  if (event.UsernameAttributes) {
    poolUsernameAttributes = JSON.parse(event.UsernameAttributes);
  }

  try {
    let totalUserProcessedCount = 0;
    let paginationToken = null;

    if (output.paginationToken && output.paginationToken !== '') {
      paginationToken = output.paginationToken;
    }

    do {
      let cognitoApiCallCount = 0;
      let currentTime = new Date().getTime();
      let oneSecondFromNow = currentTime + 1000;

      do {
        const cognitoResult = await listCognitoUsers(paginationToken, context);
        cognitoApiCallCount++;

        if (cognitoResult.users && cognitoResult.users.length > 0) {
          console.log(`Retrieved ${cognitoResult.users.length} user(s)`);
          totalUserProcessedCount += cognitoResult.users.length;
          const batchWriteUsersResponse = await batchWriteUsers(cognitoResult.users, output.ExportTimestamp, cognitoTPS, oneSecondFromNow, cognitoApiCallCount);
          cognitoApiCallCount = batchWriteUsersResponse.cognitoApiCallCount;
          oneSecondFromNow = batchWriteUsersResponse.oneSecondFromNow;
        } else {
          console.log('No users returned');
        }

        paginationToken = cognitoResult.paginationToken;
        currentTime = new Date().getTime();
      } while (paginationToken && (cognitoApiCallCount < cognitoTPS) && (currentTime < oneSecondFromNow) && (context.getRemainingTimeInMillis() > ONE_MINUTE));

      if (paginationToken && (cognitoApiCallCount >= cognitoTPS) && (currentTime < oneSecondFromNow)) {
        const waitTime = (oneSecondFromNow - currentTime);
        console.log(`Cognito transactions per second limit (${cognitoTPS}) reached. Waiting for ${(oneSecondFromNow - currentTime)}ms before proceeding`);
        await sleep(0, waitTime);
      }
    } while (paginationToken && context.getRemainingTimeInMillis() > ONE_MINUTE);

    console.log(`Successfully processed ${totalUserProcessedCount} user(s)`);
    output.paginationToken = paginationToken ? paginationToken : '';

    console.log(`Output: ${JSON.stringify(output, null, 2)}`);
    return {
      result: output,
      totalUserProcessedCount
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * List Cognito users.
 * @param {string} paginationToken - Pagination token to get next users
 * @param {object} context - Lambda context
 * @return {Promise<{ users: AWS.CognitoIdentityServiceProvider.UsersListType, paginationToken: string }>} - Cognito users and pagination token
 */
async function listCognitoUsers(paginationToken, context) {
  let cognitoResponse;

  do {
    let numAttempts = 1;

    try {
      const listUsersParams = {
        UserPoolId: USER_POOL_ID
      };

      if (paginationToken && paginationToken !== '') {
        listUsersParams.PaginationToken = paginationToken;
      }

      console.log(`Listing users: ${JSON.stringify(listUsersParams)}`);
      cognitoResponse = await cognitoIdentityServiceProvider.listUsers(listUsersParams).promise();
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
  } while (!cognitoResponse && context.getRemainingTimeInMillis() > ONE_MINUTE);

  if (cognitoResponse.Users && cognitoResponse.Users.length > 0) {
    return {
      users: cognitoResponse.Users.filter(user => user.UserStatus !== 'EXTERNAL_PROVIDER'),
      paginationToken: cognitoResponse.PaginationToken
    };
  }

  return {
    users: [],
    paginationToken: undefined
  };
}

/**
 * Batch write users into DynamoDB table.
 * @param {AWS.CognitoIdentityServiceProvider.UsersListType} users - An array of Cognito users
 * @param {number} userLastConfirmedInUserPoolDate - User last confirmed in user pool date
 * @param {number} cognitoTPS Maximum number of Cognito API calls per second  
 * @param {number} oneSecondFromNow The end time for when the Cognito API call count should be reset
 * @param {number} cognitoApiCallCount The number of Cognito API calls within the current second
 * @return {Promise<{number, number}>} The current cognitoApiCallCount and oneSecondFromNow values
 */
async function batchWriteUsers(users, userLastConfirmedInUserPoolDate, cognitoTPS, oneSecondFromNow, cognitoApiCallCount) {
  const batchWriteMax = 25;
  try {
    while (users.length > 0) {
      const batchWriteParams = {
        RequestItems: { [TABLE_NAME]: [] }
      };

      let usersToWrite = users.splice(0, batchWriteMax);

      for (let i = 0; i < usersToWrite.length; i++) {
        let user = usersToWrite[i];

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

        batchWriteParams.RequestItems[TABLE_NAME].push({
          PutRequest: {
            Item: {
              id: `USER-${subValue}`,
              type: TYPE_USER,
              username: user.Username,
              pseudoUsername: pseudoUsername,
              userAttributes: user.Attributes,
              userEnabled: user.Enabled,
              userStatus: user.UserStatus,
              lastConfirmedInUserPool: userLastConfirmedInUserPoolDate,
              lastUpdatedRegion: AWS_REGION
            }
          }
        });
      }

      let batchResult;
      do {
        console.log(`Writing ${batchWriteParams.RequestItems[TABLE_NAME].length} item(s) to ${TABLE_NAME}`);
        batchResult = await documentClient.batchWrite(batchWriteParams).promise();

        if (batchResult.UnprocessedItems[TABLE_NAME] !== undefined && batchResult.UnprocessedItems[TABLE_NAME].length > 0) {
          console.log(`Detected ${batchResult.UnprocessedItems[TABLE_NAME].length} unprocessed item(s). Waiting 100 ms then processing again`);
          batchWriteParams.RequestItems[TABLE_NAME] = batchResult.UnprocessedItems[TABLE_NAME];
          await sleep(0, 100, false);
        }
      } while (batchResult.UnprocessedItems[TABLE_NAME] !== undefined && batchResult.UnprocessedItems[TABLE_NAME].length > 0);
    }
  } catch (error) {
    console.error('Error occurred while batch writing items into dynamodb.');
    throw error;
  }

  return { cognitoApiCallCount, oneSecondFromNow };
}
