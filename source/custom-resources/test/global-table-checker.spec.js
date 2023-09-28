// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Import packages
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const axiosMock = new MockAdapter(axios);
const { mockClient } = require('aws-sdk-client-mock');
const {
  DynamoDBClient, DescribeTableCommand, ResourceNotFoundException, InternalServerError
} = require("@aws-sdk/client-dynamodb");

// Mock axios
axiosMock.onPut('/cfn-response').reply(200);

// Mock context
const context = {
  logStreamName: 'log-stream',
  getRemainingTimeInMillis: function() {
    return 100000;
  }
};

const mockDynamoDB = mockClient(DynamoDBClient);

describe('global-table-checker', function() {
  // Mock event data
  const event = {
    "StackId": "CFN_STACK_ID",
    "RequestId": "02f6b8db-835e-4a83-b338-520f642e8f97",
    "LogicalResourceId": "SecondaryUserPoolTable",
    "ResponseURL": "/cfn-response"
  };
  const describeTableResponse = {
    "Table": {
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
      "TableName": "global",
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
      "TableStatus": "ACTIVE",
      "CreationDateTime": 1592868506.319,
      "ProvisionedThroughput": {
        "NumberOfDecreasesToday": 0,
        "ReadCapacityUnits": 0,
        "WriteCapacityUnits": 0
      },
      "TableSizeBytes": 0,
      "ItemCount": 0,
      "TableArn": "arn:aws:dynamodb:mock-region:accountId:table/mock-table",
      "TableId": "069af9bb-691a-4a47-941a-09ba7c174dd4",
      "BillingModeSummary": {
        "BillingMode": "PAY_PER_REQUEST",
        "LastUpdateToPayPerRequestDateTime": 1592868506.319
      },
      "StreamSpecification": {
        "StreamEnabled": true,
        "StreamViewType": "NEW_AND_OLD_IMAGES"
      },
      "LatestStreamLabel": "2020-06-22T23:28:26.319",
      "LatestStreamArn": "arn:aws:dynamodb:mock-region:accountId:table/mock-table/stream/2020-06-22T23:28:26.319",
      "GlobalTableVersion": "2019.11.21",
      "Replicas": [
        {
          "RegionName": "primary-region",
          "ReplicaStatus": "ACTIVE"
        }
      ]
    }
  };

  beforeEach(() => {
    process.env.SECONDARY_REGION = 'mock-region';
    process.env.USER_POOL_TABLE = 'mock-table';

    mockDynamoDB.reset();
  });

  // No resource, and return
  it('should return stream ARN when DynamoDB global table is not ready at first, but ready secondly', async function() {

    mockDynamoDB.on(DescribeTableCommand).rejectsOnce(new ResourceNotFoundException({
            message: 'Table: mock-table not found'
          })).resolvesOnce(describeTableResponse)

    const index = require('../global-table-checker');
    const result = await index.handler(event, context);

    expect(result).toEqual({
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      ResponseURL: event.ResponseURL,
      LatestStreamArn: describeTableResponse.Table.LatestStreamArn
    });
  });

  // Resource, and return
  it('should return stream ARN when DynamoDB global table is ready without stream ARN firstly, but ready secondly', async function() {
    mockDynamoDB.on(DescribeTableCommand).resolvesOnce({ Table: {} }).resolvesOnce(describeTableResponse)

    const index = require('../global-table-checker');
    const result = await index.handler(event, context);

    expect(result).toEqual({
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      ResponseURL: event.ResponseURL,
      LatestStreamArn: describeTableResponse.Table.LatestStreamArn
    });
  });

  // // No resource, but timeout
  it('should return empty stream ARN when DynamoDB global table is not ready and Lambda times out', async function() {
    context.getRemainingTimeInMillis = function() {
      return 1000;
    };

    mockDynamoDB.on(DescribeTableCommand).rejects(new ResourceNotFoundException({
      message: 'Table: mock-table not found'
    }));

    const index = require('../global-table-checker');
    const result = await index.handler(event, context);

    expect(result).toEqual({
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      ResponseURL: event.ResponseURL,
      LatestStreamArn: ''
    });
  });

  // // Resource, but timeout
  it('should return empty stream ARN when DynamoDB global table is ready without stream ARN and Lambda times out', async function() {
    context.getRemainingTimeInMillis = function() {
      return 1000;
    };

    mockDynamoDB.on(DescribeTableCommand).resolves({ Table: {} });

    const index = require('../global-table-checker');
    const result = await index.handler(event, context);

    expect(result).toEqual({
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      ResponseURL: event.ResponseURL,
      LatestStreamArn: ''
    });
  });

  // // error
  it('should throw error when unexpected error occurs', async function() {
    context.getRemainingTimeInMillis = function() {
      return 100000;
    };

    mockDynamoDB.on(DescribeTableCommand).rejects(new InternalServerError({message: 'test error'}))

    const index = require('../global-table-checker');
    try {
      await index.handler(event, context);
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.message).toEqual('test error');
    }
  });
});