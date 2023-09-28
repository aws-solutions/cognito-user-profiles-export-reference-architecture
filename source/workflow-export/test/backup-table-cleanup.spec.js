// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { mockClient } = require('aws-sdk-client-mock');
const { SQS, SendMessageBatchCommand, ReceiveMessageCommand, DeleteMessageBatchCommand } = require("@aws-sdk/client-sqs");
const mockSqs = mockClient(SQS);

const { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const mockDocClient = mockClient(DynamoDBDocumentClient);

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

beforeAll(() => {
    process.env = Object.assign(process.env, {
        QUEUE_URL: 'queue-url',
        BACKUP_TABLE_NAME: 'table-name'
    });
});

describe('find-items', () => {
    beforeEach(() => {
        mockSqs.reset();
        mockDocClient.reset();
    });

    it('Should return when no items are returned', async function () {
        mockDocClient.on(ScanCommand).resolves({});

        const event = {
            Context: {
                State: { Name: 'BackupTableCleanup: Find Items' }
            },
            Input: { ExportTimestamp: new Date().getTime() }
        };

        const lambda = require('../backup-table-cleanup');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            result: {
                NumItemsAddedToQueue: 0,
                ExportTimestamp: event.Input.ExportTimestamp,
                lastEvaluatedKey: ''
            }
        });
    });

    it('Should return when some items are returned', async function () {
        mockDocClient.on(ScanCommand).resolvesOnce({
            Count: 2,
            ScannedCount: 100,
            Items: [
                { id: 'user-id', type: 'user-type' },
                { id: 'user-id2', type: 'user-type' }
            ],
            LastEvaluatedKey: { id: 'last-eval-id', type: 'user-type' }
        }).resolvesOnce({
            Count: 2,
            ScannedCount: 100,
            Items: [
                { id: 'user-id', type: 'user-type' },
                { id: 'user-id2', type: 'user-type' }
            ]
        });

        mockSqs.on(SendMessageBatchCommand).resolvesOnce({});

        const event = {
            Context: {
                State: { Name: 'BackupTableCleanup: Find Items' }
            },
            Input: { ExportTimestamp: new Date().getTime(), lastEvaluatedKey: { id: 'last-eval-id', type: 'user-type' } }
        };

        const lambda = require('../backup-table-cleanup');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            result: {
                NumItemsAddedToQueue: 4,
                ExportTimestamp: event.Input.ExportTimestamp,
                lastEvaluatedKey: ''
            }
        });
    });
});

describe('remove-items', () => {
    beforeEach(() => {
        mockSqs.reset();
    });

    it('NOOP for unknown state name', async function () {
        const event = {
            Context: {
                State: { Name: 'UNKNOWN' }
            },
            Input: { ExportTimestamp: new Date().getTime() }
        };

        const lambda = require('../backup-table-cleanup');
        await lambda.handler(event, context);
    });

    it('Should return when no messages are in the queue', async function () {
        mockSqs.on(ReceiveMessageCommand).resolves({});

        const event = {
            Context: {
                State: { Name: 'BackupTableCleanup: Remove Items' }
            },
            Input: { ExportTimestamp: new Date().getTime() }
        };

        const lambda = require('../backup-table-cleanup');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            result: {
                IsQueueEmpty: true,
                ExportTimestamp: event.Input.ExportTimestamp,
                NumItemsAddedToQueue: 0
            }
        });
    });

    it('Should return when some messages are in the queue', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({
                Messages: [
                    { Body: JSON.stringify({ Key: { id: 'id', type: 'type' } }) }
                ]
            }).resolves({});

        mockSqs.on(DeleteMessageBatchCommand).resolvesOnce({});

        mockDocClient.on(BatchWriteCommand).resolvesOnce({
            UnprocessedItems: {
                'table-name': [{ id: 'id', type: 'type' }]
            }
        }).resolvesOnce({
            UnprocessedItems: {}
        });

        const event = {
            Context: {
                State: { Name: 'BackupTableCleanup: Remove Items' }
            },
            Input: { ExportTimestamp: new Date().getTime(), lastEvaluatedKey: { id: 'last-eval-id', type: 'user-type' } }
        };

        const lambda = require('../backup-table-cleanup');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            result: {
                NumItemsAddedToQueue: 0,
                IsQueueEmpty: true,
                ExportTimestamp: event.Input.ExportTimestamp
            }
        });
    });
});
