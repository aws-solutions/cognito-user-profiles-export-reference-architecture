// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock context
const context = {
    logStreamName: 'log-stream'
};

// Mock AWS SDK
const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const mockDocClient = mockClient(DynamoDBDocumentClient);

describe('export-group', () => {
    beforeEach(() => {
        mockDocClient.reset();
    });

    it('Should return successfully after adding group to DDB', async function () {
        const event = {
            groupName: 'group-name',
            groupDescription: 'group-desc',
            groupPrecedence: 1,
            groupLastModifiedDate: new Date().toISOString(),
            exportTimestamp: new Date().getTime()
        };

        mockDocClient.on(PutCommand).resolves({});

        const lambda = require('../export-group');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({ exportTimestamp: event.exportTimestamp, groupName: 'group-name' });
    });
});