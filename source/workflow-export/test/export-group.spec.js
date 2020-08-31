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
const mockDocClient = {
    put: jest.fn()
};

jest.mock('aws-sdk', () => {
    return {
        DynamoDB: {
            DocumentClient: jest.fn(() => ({
                put: mockDocClient.put
            }))
        }
    };
});

describe('export-group', () => {
    beforeEach(() => {
        for (const mockFn in mockDocClient) {
            mockDocClient[mockFn].mockReset();
        }
    });

    it('Should return successfully after adding group to DDB', async function () {
        const event = {
            groupName: 'group-name',
            groupDescription: 'group-desc',
            groupPrecedence: 1,
            groupLastModifiedDate: new Date().toISOString(),
            exportTimestamp: new Date().getTime()
        };

        mockDocClient.put.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        const lambda = require('../export-group');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({ exportTimestamp: event.exportTimestamp, groupName: 'group-name' });
    });
});