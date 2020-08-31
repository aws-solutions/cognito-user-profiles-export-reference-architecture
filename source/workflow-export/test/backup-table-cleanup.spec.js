// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const mockSqs = {
    sendMessageBatch: jest.fn(),
    receiveMessage: jest.fn(),
    deleteMessageBatch: jest.fn()
};

const mockDocClient = {
    scan: jest.fn(),
    batchWrite: jest.fn()
};

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

jest.mock('aws-sdk', () => {
    return {
        SQS: jest.fn(() => ({
            sendMessageBatch: mockSqs.sendMessageBatch,
            receiveMessage: mockSqs.receiveMessage,
            deleteMessageBatch: mockSqs.deleteMessageBatch
        })),
        DynamoDB: {
            DocumentClient: jest.fn(() => ({
                scan: mockDocClient.scan,
                batchWrite: mockDocClient.batchWrite
            }))
        }
    };
});

beforeAll(() => {
    process.env = Object.assign(process.env, {
        QUEUE_URL: 'queue-url',
        BACKUP_TABLE_NAME: 'table-name'
    });
});

describe('find-items', () => {
    beforeEach(() => {
        jest.resetModules();
        for (const mockFn in mockSqs) {
            mockSqs[mockFn].mockReset();
        }

        for (const mockFn in mockDocClient) {
            mockDocClient[mockFn].mockReset();
        }
    });

    it('Should return when no items are returned', async function () {
        mockDocClient.scan.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

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
        mockDocClient.scan.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Count: 2,
                        ScannedCount: 100,
                        Items: [
                            { id: 'user-id', type: 'user-type' },
                            { id: 'user-id2', type: 'user-type' }
                        ],
                        LastEvaluatedKey: { id: 'last-eval-id', type: 'user-type' }
                    });
                }
            };
        }).mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Count: 2,
                        ScannedCount: 100,
                        Items: [
                            { id: 'user-id', type: 'user-type' },
                            { id: 'user-id2', type: 'user-type' }
                        ]
                    });
                }
            };
        });

        mockSqs.sendMessageBatch.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

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
        jest.resetModules();
        for (const mockFn in mockSqs) {
            mockSqs[mockFn].mockReset();
        }

        for (const mockFn in mockDocClient) {
            mockDocClient[mockFn].mockReset();
        }
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
        mockSqs.receiveMessage.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

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
        mockSqs.receiveMessage.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Messages: [
                            { Body: JSON.stringify({ Key: { id: 'id', type: 'type' } }) }
                        ]
                    });
                }
            };
        }).mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockSqs.deleteMessageBatch.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({})
                }
            }
        });

        mockDocClient.batchWrite.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        UnprocessedItems: {
                            'table-name': [{ id: 'id', type: 'type' }]
                        }
                    })
                }
            }
        }).mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        UnprocessedItems: {}
                    })
                }
            }
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
