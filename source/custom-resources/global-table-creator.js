// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
        DynamoDB
      } = require("@aws-sdk/client-dynamodb"),
      {
        SFN: StepFunctions
      } = require("@aws-sdk/client-sfn");
const dynamodb = new DynamoDB(getOptions());
const stepFunctions = new StepFunctions(getOptions());
const axios = require('axios');

/**
 * Adds a replica to the Backup Table in the Secondary Region
 * @param {object} event
 * @param {object} context
 * @return {Promise<object>}
 */
exports.handler = async (event, context) => {
  console.log(`Received event: ${JSON.stringify(event)}`);

  const properties = event.ResourceProperties;

  try {
    if (event.RequestType === 'Create') {
      const dynamodbResponse = await createGlobalTable(properties);
      console.log(`DynamoDB Update: ${JSON.stringify(dynamodbResponse, null, 2)}`);

      // The step function workflow will respond to CloudFormation after 
      // the Global Table has fully been created
      await startStepFunction(
        properties.StateMachineArn,
        JSON.stringify({
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          ResponseURL: event.ResponseURL
        })
      );
      console.log(`Step Function Execution: ${JSON.stringify()}`)
    } else {
      await sendResponse(event, context.logStreamName, { status: 'SUCCESS', data: {} });
    }
  } catch (error) {
    console.error(error);
    const response = {
      status: 'FAILED',
      data: { Error: error.message }
    };

    await sendResponse(event, context.logStreamName, response);

    return response;
  }

  return event;
}

/**
 * Create DynamoDB global table in the secondary region
 * @param {object} properties - Custom resource properties { UserPoolTable: string, SecondaryRegion: string }
 * @return {Promise<AWS.DynamoDB.UpdateTableOutput>}
 */
async function createGlobalTable(properties) {
  const { UserPoolTable, SecondaryRegion } = properties;

  try {
    return await dynamodb.updateTable({
      TableName: UserPoolTable,
      ReplicaUpdates: [
        {
          Create: { RegionName: SecondaryRegion }
        }
      ]
    });
  } catch (error) {
    console.error(`Error occurred while creating global table in ${SecondaryRegion}.`);
    throw error;
  }
}

/**
 * Start Step Function to check the status of global table creation.
 * @param {string} stateMachineArn - Step Function state machine ARN
 * @param {string} input - Stringified JSON object
 * @return {Promise<AWS.StepFunctions.StartExecutionOutput>}
 */
async function startStepFunction(stateMachineArn, input) {
  try {
    return await stepFunctions.startExecution({
      stateMachineArn,
      input
    });
  } catch (error) {
    console.error('Error occurred while starting step function.');
    throw error;
  }
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