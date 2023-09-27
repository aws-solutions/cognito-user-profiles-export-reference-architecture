// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Import packages
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const axiosMock = new MockAdapter(axios);
const {
  DynamoDBClient, UpdateTableCommand, LimitExceededException
} = require("@aws-sdk/client-dynamodb"),
{
  SFNClient: StepFunctionsClient, StartExecutionCommand, ExecutionAlreadyExists
  
} = require("@aws-sdk/client-sfn");
const { mockClient } = require('aws-sdk-client-mock');

// Mock axios
axiosMock.onPut('/cfn-response').reply(200);

// Mock context
const context = {
  logStreamName: 'log-stream'
};

const mockDynamoDB = mockClient(DynamoDBClient);
const mockStepFucntions = mockClient(StepFunctionsClient);

describe('global-table-creator', function() {
  // Mock event data
  const event = {
    "RequestType": "Create",
    "ServiceToken": "LAMBDA_ARN",
    "ResponseURL": "/cfn-response",
    "StackId": "CFN_STACK_ID",
    "RequestId": "02f6b8db-835e-4a83-b338-520f642e8f97",
    "LogicalResourceId": "SecondaryUserPoolTable",
    "ResourceType": "Custom::CreateTable",
    "ResourceProperties": {
      "ServiceToken": "LAMBDA_ARN",
      "UserPoolTable": "user-pool-table",
      "SecondaryRegion": "mock-secondary-region"
    }
  };
  const updateTableResponse = {
    "TableDescription": {
      "AttributeDefinitions": [
        {
          "AttributeName": "id",
          "AttributeType": "S"
        },
        {
          "AttributeName": "type",
          "AttributeType": "S"
        }
      ],
        "TableName": "user-pool-table",
        "KeySchema": [
          {
            "AttributeName": "id",
            "KeyType": "HASH"
          },
          {
            "AttributeName": "type",
            "KeyType": "RANGE"
          }
        ],
        "TableStatus": "UPDATING",
        "CreationDateTime": "2020-06-15T21:51:39.371Z",
        "ProvisionedThroughput": {
          "NumberOfDecreasesToday": 0,
          "ReadCapacityUnits": 0,
          "WriteCapacityUnits": 0
        },
        "TableSizeBytes": 0,
        "ItemCount": 0,
        "TableArn": "arn:of:dynamodb:mock-primary-region:account-id:table/user-pool-table",
        "TableId": "3901dd6b-86da-4521-9b8e-564353348ffe",
        "BillingModeSummary": {
          "BillingMode": "PAY_PER_REQUEST",
          "LastUpdateToPayPerRequestDateTime": "2020-06-15T21:51:39.371Z"
        },
        "StreamSpecification": {
          "StreamEnabled": true,
          "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "LatestStreamLabel": "2020-06-15T21:51:48.977",
        "LatestStreamArn": "arn:of:dynamodb:mock-primary-region:account-id:table/user-pool-table/stream/2020-06-15T21:51:48.977",
        "GlobalTableVersion": "2019.11.21"
    }
  };

  beforeEach(() => {
    mockDynamoDB.reset();
    mockStepFucntions.reset();
  });

  it('should return event when DynamoDB global table creation and Step Function execution succeed', async function() {
    mockDynamoDB.on(UpdateTableCommand).resolves(updateTableResponse);
    mockStepFucntions.on(StartExecutionCommand).resolves({
      executionArn: 'arn-of-step-function-execution',
      startDate: new Date()
    })

    const index = require('../global-table-creator');
    const result = await index.handler(event, context);

    expect(result).toEqual(event);
  });

  it('should return failure when DynamoDB global table creation fails', async function() {
    mockDynamoDB.on(UpdateTableCommand).rejects(new LimitExceededException({ message: 'ERROR to update the table' }));

    const index = require('../global-table-creator');
    const result = await index.handler(event, context);

    expect(result).toEqual({
      status: 'FAILED',
      data: { Error: 'ERROR to update the table' }
    });
  });

  it('should return failure when Step Function start execution fails', async function() {
    mockDynamoDB.on(UpdateTableCommand).resolves(updateTableResponse);
    mockStepFucntions.on(StartExecutionCommand).rejects(new ExecutionAlreadyExists({ message: 'ERROR to start execution' }))

    const index = require('../global-table-creator');
    const result = await index.handler(event, context);

    expect(result).toEqual({
      status: 'FAILED',
      data: { Error: 'ERROR to start execution' }
    });
  });

  it('should return failure when update event comes in', async function() {
    event.RequestType = 'Update';

    const index = require('../global-table-creator');
    const result = await index.handler(event, context);

    expect(result).toEqual(event);
  });

  it('should return event when delete event comes in', async function() {
    event.RequestType = 'Delete';

    const index = require('../global-table-creator');
    const result = await index.handler(event, context);

    expect(result).toEqual(event);
  });
});