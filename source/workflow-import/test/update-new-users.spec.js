// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK
const mockCognitoISP = {
    getCSVHeader: jest.fn(),
    createUserImportJob: jest.fn(),
    startUserImportJob: jest.fn(),
    describeUserImportJob: jest.fn(),
    adminAddUserToGroup: jest.fn(),
    adminDisableUser: jest.fn()
};

const mockDocClient = {
    scan: jest.fn()
};

const mockSqs = {
    sendMessageBatch: jest.fn(),
    receiveMessage: jest.fn(),
    deleteMessageBatch: jest.fn()
};

const mockS3 = {
    scan: jest.fn(),
    putObject: jest.fn()
};

jest.mock('aws-sdk', () => {
    return {
        CognitoIdentityServiceProvider: jest.fn(() => ({
            getCSVHeader: mockCognitoISP.getCSVHeader,
            createUserImportJob: mockCognitoISP.createUserImportJob,
            startUserImportJob: mockCognitoISP.startUserImportJob,
            describeUserImportJob: mockCognitoISP.describeUserImportJob,
            adminAddUserToGroup: mockCognitoISP.adminAddUserToGroup,
            adminDisableUser: mockCognitoISP.adminDisableUser
        })),
        DynamoDB: {
            DocumentClient: jest.fn(() => ({
                scan: mockDocClient.scan
            }))
        },
        SQS: jest.fn(() => ({
            sendMessageBatch: mockSqs.sendMessageBatch,
            receiveMessage: mockSqs.receiveMessage,
            deleteMessageBatch: mockSqs.deleteMessageBatch
        })),
        S3: jest.fn(() => ({
            scan: mockS3.scan,
            putObject: mockS3.putObject
        })),
        config: {
            update: jest.fn()
        }
    };
});

// Mock Axios
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const axiosMock = new MockAdapter(axios);
axiosMock.onPut('/pre-signed-url').reply(200);

// Mock metrics client
const Metrics = require('../../utils/metrics');
jest.mock('../../utils/metrics');

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

    for (const mockFn in mockCognitoISP) {
        mockCognitoISP[mockFn].mockReset();
    }

    for (const mockFn in mockDocClient) {
        mockDocClient[mockFn].mockReset();
    }

    for (const mockFn in mockSqs) {
        mockSqs[mockFn].mockReset();
    }
});

describe('import-new-users: UpdateNewUsers', function () {
    it('Returns when no messages are returned from the Queue', async function () {
        mockSqs.receiveMessage.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({ Messages: [] });
                }
            };
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

    it('Returns when a user was added but no groups to add', async function () {
        mockSqs.receiveMessage.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
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
                    });
                }
            };
        }).mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Messages: []
                    });
                }
            };
        });

        mockCognitoISP.adminAddUserToGroup.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockSqs.deleteMessageBatch.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
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

    it('Returns when a user was added and a group needs to be added', async function () {
        mockSqs.receiveMessage.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
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
                    });
                }
            };
        }).mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Messages: []
                    });
                }
            };
        });

        mockDocClient.scan.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Items: [{
                            id: 'group-name:group',
                            GroupName: 'group-name'
                        }]
                    });
                }
            };
        });

        mockSqs.deleteMessageBatch.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockCognitoISP.adminAddUserToGroup.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
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

    it('Returns when a user was added and then needs to be disabled', async function () {
        mockSqs.receiveMessage.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
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
                    });
                }
            };
        }).mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Messages: []
                    });
                }
            };
        });

        mockSqs.deleteMessageBatch.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockCognitoISP.adminDisableUser.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
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
});

describe('import-new-users: Errors', function () {
    beforeEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: 'invalid' });
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
