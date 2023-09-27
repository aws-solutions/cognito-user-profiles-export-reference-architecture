// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

// Mock AWS SDK
const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, CreateGroupCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognitoISP = mockClient(CognitoIdentityProvider);

const { SQS, SendMessageBatchCommand } = require("@aws-sdk/client-sqs");
const mockSqs = mockClient(SQS);

const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const mockDocClient = mockClient(DynamoDBDocumentClient);

beforeAll(() => {
    process.env = Object.assign(process.env, {
        BACKUP_TABLE_NAME: 'backup-table',
        USER_POOL_ID: 'user-pool-id', TYPE_GROUP: 'group-type',
        TYPE_USER: 'user-type', COGNITO_TPS: '10',
        TYPE_TIMESTAMP: 'timestamp-type',
        NEW_USERS_QUEUE_URL: 'new-user-queue',
        NEW_USERS_UPDATES_QUEUE_URL: 'new-users-updates-queue'
    });

    context.getRemainingTimeInMillis = function () {
        return 100000;
    }
});

describe('groups', function () {
    beforeEach(() => {
        mockCognitoISP.reset();
        mockSqs.reset();
        mockDocClient.reset();
    })
    it('Returns Yes if no groups are returned', async function () {
        mockDocClient.on(ScanCommand).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        const result = await lambda.handler(event);
        expect(result).toEqual({
            result: { AllGroupsProcessed: 'Yes' }
        });
    });

    it('Returns No if a LastEvaluatedKey is returned and the function is out of time', async function () {
        context.getRemainingTimeInMillis = function () {
            return 1;
        }
        mockDocClient.on(ScanCommand).resolvesOnce({ LastEvaluatedKey: 'another-key' });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: { AllGroupsProcessed: 'No', LastEvaluatedKey: 'another-key' }
        });
    });

    it('Returns "No" if only a sync timestamp is returned', async function () {
        context.getRemainingTimeInMillis = function () {
            return 1;
        }

        mockDocClient.on(ScanCommand).resolvesOnce({
            Items: [
                {
                    latestExportTimestamp: new Date().getTime(),
                    type: 'timestamp-type'
                }
            ]
        });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: { AllGroupsProcessed: 'Yes' }
        });
    });

    it('Returns "Yes" when one group needs to be added', async function () {
        mockDocClient.on(ScanCommand).resolvesOnce({
            Items: [
                {
                    id: 'GROUP-12345',
                    type: 'group-type',
                    groupName: 'group-name-2',
                    groupDescription: 'desc-2',
                    groupPrecedence: 1
                }
            ]
        });

        mockCognitoISP.on(CreateGroupCommand).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        const result = await lambda.handler(event);
        expect(result).toEqual({
            result: { AllGroupsProcessed: 'Yes' }
        });
    });

    it('Returns "Yes" a new user needs to be disabled', async function () {
        mockDocClient.on(ScanCommand).resolvesOnce({
            Items: [
                {
                    id: 'USER-12345',
                    type: 'user-type',
                    userEnabled: false
                }
            ]
        });

        mockSqs.on(SendMessageBatchCommand).resolvesOnce({}).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        const result = await lambda.handler(event);
        expect(result).toEqual({
            result: { AllGroupsProcessed: 'Yes' }
        });
    });

    it('Returns "Yes" for a group membership message', async function () {
        mockDocClient.on(ScanCommand).resolvesOnce({
            Items: [
                {
                    id: 'USER-12345',
                    type: 'group-member:group1',
                    userEnabled: false
                }
            ]
        });

        mockSqs.on(SendMessageBatchCommand).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        const result = await lambda.handler(event);
        expect(result).toEqual({
            result: { AllGroupsProcessed: 'Yes' }
        });
    });

    it('Throws an error if Cognito throws an unexpected error', async function () {
        mockDocClient.on(ScanCommand).resolvesOnce({
            Items: [
                {
                    id: 'GROUP-12345',
                    type: 'group-type',
                    groupName: 'group-name-2',
                    groupDescription: 'desc-2',
                    groupPrecedence: 1
                }
            ]
        });

        mockCognitoISP.on(CreateGroupCommand).resolvesOnce({ code: 'UnexpectedError' });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../scan-table');
        try {
            await lambda.handler(event);
        } catch (err) {
            expect(err.code).toEqual('UnexpectedError')
        }
    });

    it('Throws an error if the user pool id is not supplied', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: '' } }
            }
        };

        const lambda = require('../scan-table');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to determine the new user pool ID');
    });
});

describe('groups-invalid CognitoTPS', function () {
    beforeEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: 'invalid' });
    });

    it('Throws an error if an invalid CognitoTPS value is set', async function () {
        const event = { LastEvaluatedKey: 'last-key' };
        const lambda = require('../scan-table');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to parse a number from the COGNITO_TPS value (invalid)');
    });
});
