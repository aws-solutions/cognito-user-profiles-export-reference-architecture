// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { USER_POOL_TABLE, SECONDARY_REGION } = process.env;
const ONE_MINUTE = 60 * 1000;
const { getOptions } = require('../utils/metrics');

const {
  DynamoDB
} = require("@aws-sdk/client-dynamodb");
const dynamodb = new DynamoDB(getOptions({ region: SECONDARY_REGION }));
const axios = require('axios');

/**
 * Checks the status of the Backup Table replica and when active, response to CloudFormation
 * @param {object} event
 * @param {object} context
 */
exports.handler = async (event, context) => {
  console.log(`Requested event: ${JSON.stringify(event, null, 2)}`);

  const output = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    ResponseURL: event.ResponseURL,
    LatestStreamArn: ''
  };

  while (output.LatestStreamArn === '' && context.getRemainingTimeInMillis() > ONE_MINUTE) {
    try {
      output.LatestStreamArn = await getSecondaryLastestStreamArn();
    } catch (error) {
      // If the table is not created yet, continue after a sleep.
      if (error.name === 'ResourceNotFoundException') {
        await sleep(1);
        continue;
      } else {
        console.error(`Error occurred while getting secondary lastest stream ARN.`, error);

        await sendResponse(event, context.logStreamName, {
          status: 'FAILED',
          data: { Error: error.message }
        });
        throw error;
      }
    }
  }

  if (output.LatestStreamArn !== '') {
    // Send response
    await sendResponse(event, context.logStreamName, {
      status: 'SUCCESS',
      data: {
        LatestStreamArn: output.LatestStreamArn
      }
    });
  }

  return output;
}

/**
 * Return the latest secondary region's global table stream ARN.
 * @return {Promise<string>} - Latest stream ARN or empty string
 */
async function getSecondaryLastestStreamArn() {
  const response = await dynamodb.describeTable({
    TableName: USER_POOL_TABLE
  });

  return response.Table.LatestStreamArn ? response.Table.LatestStreamArn : '';
}

/**
 * Sleep for the provided second(s).
 * @return {Promise} - Sleep promise
 */
async function sleep(second) {
  return new Promise(resolve => setTimeout(resolve, second * 1000));
}

/**
 * Send custom resource response.
 * @param {object} event - Custom resource event
 * @param {string} logStreamName - Custom resource log stream name
 * @param {object} response - Response object { status: "SUCCESS|FAILED", data: object }
 */
async function sendResponse(event, logStreamName, response) {
  const responseBody = JSON.stringify({
    Status: response.status,
    Reason: `See the details in CloudWatch Log Stream: ${logStreamName}`,
    PhysicalResourceId: logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: response.data,
  });

  const config = {
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length
    }
  };

  await axios.put(event.ResponseURL, responseBody, config);
}