// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK
const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, AdminAddUserToGroupCommand, AdminDisableUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognitoISP = mockClient(CognitoIdentityProvider);

const { SQS, ReceiveMessageCommand, DeleteMessageBatchCommand } = require("@aws-sdk/client-sqs");
const mockSqs = mockClient(SQS);

// Mock Axios
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const axiosMock = new MockAdapter(axios);
axiosMock.onPut('/pre-signed-url').reply(200);

// Mock metrics client
const Metrics = require('../../utils/metrics');
jest.mock('../../utils/metrics');

// Mock helper client
const helper = require('../../utils/helper-functions');
jest.mock('../../utils/helper-functions');

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

beforeAll(() => {
    process.env = Object.assign(process.env, {
        AWS_REGION: 'us-east-2',
        USER_IMPORT_JOB_MAPPING_FILES_BUCKET: 'mapping-bucket',
        SEND_METRIC: 'Yes',
        METRICS_ANONYMOUS_UUID: 'uuid',
        SOLUTION_ID: 'SOMock',
        SOLUTION_VERSION: 'v1.0.0',
        NEW_USERS_QUEUE_URL: 'queue-url',
        NEW_USERS_UPDATES_QUEUE_URL: 'another-queue-url',
        COGNITO_TPS: '10',
        TYPE_USER: 'user-type',
        TYPE_GROUP: 'group-type'
    });
});

describe('import-new-users: UpdateNewUsers', function () {
    beforeEach(() => {
        mockCognitoISP.reset();
        mockSqs.reset();
    })
    it('Returns when no messages are returned from the Queue', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({ Messages: [] });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            }
        };
        const lambda = require('../update-new-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                QueueEmpty: true,
                StateName: event.Context.State.Name
            }
        });
    });

    it('Returns when a user was added but no groups to add', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({
            Messages: [
                {
                    Body: JSON.stringify({
                        id: 'row-id',
                        type: 'user : uuid',
                        username: 'test-user',
                        userAttributes: [{
                            Name: 'sub',
                            Value: 'uuid'
                        }],
                        userEnabled: false
                    })
                }
            ]
        }).resolvesOnce({ Messages: [] });

        mockCognitoISP.on(AdminAddUserToGroupCommand).resolvesOnce({});

        mockSqs.on(DeleteMessageBatchCommand).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            }
        };
        const lambda = require('../update-new-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                QueueEmpty: true,
                StateName: event.Context.State.Name
            }
        });
    });

    it('Returns when a user was added and a group needs to be added', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({
                Messages: [
                    {
                        Body: JSON.stringify({
                            id: 'row-id',
                            type: 'user : uuid',
                            username: 'test-user',
                            userAttributes: [{
                                Name: 'sub',
                                Value: 'uuid'
                            }],
                            userEnabled: true
                        })
                    }
                ]
            
            }).resolvesOnce({Messages: []});

        mockSqs.on(DeleteMessageBatchCommand).resolvesOnce({});

        mockCognitoISP.on(AdminAddUserToGroupCommand).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            }
        };
        const lambda = require('../update-new-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                QueueEmpty: true,
                StateName: event.Context.State.Name
            }
        });
    });

    it('Returns when a user was added and then needs to be disabled', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({
                Messages: [
                    {
                        Body: JSON.stringify({
                            id: 'row-id',
                            type: 'user-type',
                            username: 'test-user',
                            userAttributes: [{
                                Name: 'sub',
                                Value: 'uuid'
                            }],
                            userEnabled: false
                        })
                    }
                ]
            
        }).resolvesOnce({
                Messages: []
            
        });

        mockSqs.on(DeleteMessageBatchCommand).resolvesOnce(() => {
            return Promise.resolve({});
        });

        mockCognitoISP.on(AdminDisableUserCommand).resolvesOnce(() => {
            return Promise.resolve({});
        });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            }
        };
        const lambda = require('../update-new-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                QueueEmpty: true,
                StateName: event.Context.State.Name
            }
        });
    });


    it('Throw error when deleting message batches fails', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({
                Messages: [
                    {
                        Body: JSON.stringify({
                            id: 'row-id',
                            type: 'user-type',
                            username: 'test-user',
                            userAttributes: [{
                                Name: 'sub',
                                Value: 'uuid'
                            }],
                            userEnabled: false
                        })
                    }
                ]
            }).resolvesOnce({
                Messages: []
            });

        mockSqs.on(DeleteMessageBatchCommand).rejects('DeletionError')

        mockCognitoISP.on(AdminDisableUserCommand).resolvesOnce(() => {
            return Promise.resolve({});
        });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            }
        };
        const lambda = require('../update-new-users');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('DeletionError');
    });


});

describe('import-new-users: Reseting', function(){


    beforeEach(() => {
        jest.resetModules();        
        process.env = Object.assign(process.env, { COGNITO_TPS: '0' });
    });

    it('Resets when cognitoApiCallCount >= cognitoTPS', async function () {

        const { CognitoIdentityProvider, AdminAddUserToGroupCommand, AdminDisableUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
        const mockCognitoISP = mockClient(CognitoIdentityProvider);

        const { SQS, ReceiveMessageCommand, DeleteMessageBatchCommand } = require("@aws-sdk/client-sqs");
        const mockSqs = mockClient(SQS);

        const mockSqs2 = mockClient(SQS);
        const mockCognitoISP2 = mockClient(CognitoIdentityProvider);
        console.log('start resets test')
        process.env = { COGNITO_TPS: '0' };

        mockSqs2.on(ReceiveMessageCommand).resolvesOnce({
                Messages: [
                    {
                        Body: JSON.stringify({
                            id: 'row-id',
                            type: 'user-type',
                            username: 'test-user',
                            userAttributes: [{
                                Name: 'sub',
                                Value: 'uuid'
                            }],
                            userEnabled: false
                        })
                    },
                    {
                        Body: JSON.stringify({
                            id: 'row-id',
                            type: 'user-type',
                            username: 'test-user',
                            userAttributes: [{
                                Name: 'sub',
                                Value: 'uuid'
                            }],
                            userEnabled: false
                        })
                    }
                ]}).resolvesOnce({
                Messages: []
            });
        

        mockSqs2.on(DeleteMessageBatchCommand).resolvesOnce({});

        mockCognitoISP2.on(AdminDisableUserCommand).resolvesOnce({});

        console.log(process.env)
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            }
        };
        const lambda = require('../update-new-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                QueueEmpty: true,
                StateName: event.Context.State.Name
            }
        });        
    });
});

describe('import-new-users: Errors', function () {
    beforeEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: 'invalid' });
    });

    afterEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: '10' });
    });

    it('Throws an error if an invalid CognitoTPS value is set', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../update-new-users');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to parse a number from the COGNITO_TPS value (invalid)');
    });

    it('Throws an error if the user pool id is not supplied', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: '' } }
            }
        };

        const lambda = require('../update-new-users');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to determine the new user pool ID');
    });
});
