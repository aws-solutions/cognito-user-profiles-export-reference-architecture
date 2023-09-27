// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, GetCSVHeaderCommand, CreateUserImportJobCommand,
    StartUserImportJobCommand, DescribeUserImportJobCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognitoISP = mockClient(CognitoIdentityProvider);

const { S3, PutObjectCommand } = require("@aws-sdk/client-s3");
const mockS3 = mockClient(S3);

const { SQS, SendMessageBatchCommand, ReceiveMessageCommand, DeleteMessageBatchCommand } = require("@aws-sdk/client-sqs");
const mockSqs = mockClient(SQS);

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
});

describe('import-new-users: Unknown State Name', function () {
    it('Throws error for unknown state name', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'Unknown' }
            }
        };
        const lambda = require('../import-users');
        await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('Unknown StateName: Unknown');
    });
});

describe('import-new-users: ImportNewUsers', function () {
    beforeEach(() => {
        mockCognitoISP.reset();
        mockSqs.reset();
        mockS3.reset();
    })
    it('Returns when no messages are returned from the Queue', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({ Messages: [] });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'ImportNewUsers' }
            }
        };
        const lambda = require('../import-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                ImportJobStatus: '',
                QueueEmpty: true,
                StateName: event.Context.State.Name
            }
        });
    });

    it('Creates an import job when a new user is added and returns the job id', async function () {
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

        mockCognitoISP.on(GetCSVHeaderCommand).resolvesOnce({ CSVHeader: ['cognito:username', 'cognito:mfa_enabled', 'custom:foobar', 'email_verified', 'phone_number_verified'] });
        mockSqs.on(SendMessageBatchCommand).resolvesOnce({});
        mockSqs.on(DeleteMessageBatchCommand).resolvesOnce({});
        mockCognitoISP.on(CreateUserImportJobCommand).resolvesOnce({ UserImportJob: { JobId: 'job-id', Status: 'Pending', PreSignedUrl: '/pre-signed-url' } });
        mockS3.on(PutObjectCommand).resolvesOnce({});
        mockCognitoISP.on(StartUserImportJobCommand).resolvesOnce({ UserImportJob: { JobId: 'job-id', Status: 'Pending', PreSignedUrl: '/pre-signed-url' } });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'ImportNewUsers' }
            }
        };
        const lambda = require('../import-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                ImportJobStatus: 'Pending',
                ImportJobId: 'job-id',
                QueueEmpty: false,
                StateName: event.Context.State.Name
            }
        });
    });

    it('Throws an error when the sub can\'t be retrieved', async function () {
        mockSqs.on(ReceiveMessageCommand).resolvesOnce({
            Messages: [
                {
                    Body: JSON.stringify({
                        id: 'row-id',
                        type: 'user : uuid',
                        username: 'test-user',
                        userAttributes: [{
                            Name: 'not-the-sub',
                            Value: 'uuid'
                        }],
                        userEnabled: true
                    })
                }
            ]
        });

        mockCognitoISP.on(GetCSVHeaderCommand).resolvesOnce(
            { CSVHeader: ['cognito:username', 'cognito:mfa_enabled', 'custom:foobar', 'email_verified', 'phone_number_verified'] }
        );

        mockSqs.on(SendMessageBatchCommand).resolvesOnce(() => {
            return Promise.resolve({});
        });

        mockSqs.on(DeleteMessageBatchCommand).resolvesOnce({});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'ImportNewUsers' }
            }
        };
        const lambda = require('../import-users');
        await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('Unable to extract user\'s sub attribute');
    });
});

describe('import-new-users: CheckUserImportJob', function () {
    beforeEach(() => {
        mockCognitoISP.reset();
        mockSqs.reset();
        mockS3.reset();
    })
    it('Throws an error when the job fails', async function () {
        mockCognitoISP.on(DescribeUserImportJobCommand).resolvesOnce({ UserImportJob: { Status: 'Failed', JobId: 'job-id' } });

        Metrics.sendAnonymousMetric.mockImplementationOnce(async (x, y, z) => {
            return Promise.resolve({});
        });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'CheckUserImportJob' }
            },
            Input: { ImportJobId: 'job-id' }
        };

        const lambda = require('../import-users');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('User import job with ID "job-id" was detected to have a status of "Failed" in us-east-2.\n\nPlease check the CloudWatch logs for this Cognito user import job and use the mapping file (job-id-user-mapping.csv) that has been saved in this the solution\'s S3 bucket (mapping-bucket) to cross-reference the line numbers reported the user import job CloudWatch logs');
    });

    it('Returns the expected result when the job is still Pending', async function () {
        mockCognitoISP.on(DescribeUserImportJobCommand).resolvesOnce({ UserImportJob: { Status: 'Pending', JobId: 'job-id' } });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'CheckUserImportJob' }
            },
            Input: { ImportJobId: 'job-id' }
        };
        const lambda = require('../import-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                ImportJobStatus: 'Pending',
                ImportJobId: 'job-id',
                StateName: event.Context.State.Name
            }
        });
    });

    it('Returns the expected result when the job is still InProgress', async function () {
        mockCognitoISP.on(DescribeUserImportJobCommand).resolvesOnce({ UserImportJob: { Status: 'InProgress', JobId: 'job-id' } });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'CheckUserImportJob' }
            },
            Input: { ImportJobId: 'job-id' }
        };
        const lambda = require('../import-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                ImportJobStatus: 'InProgress',
                ImportJobId: 'job-id',
                StateName: event.Context.State.Name
            }
        });
    });

    it('Returns the expected result when the job Succeeded', async function () {
        mockCognitoISP.on(DescribeUserImportJobCommand).resolvesOnce({ UserImportJob: { Status: 'Succeeded', JobId: 'job-id' } });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'CheckUserImportJob' }
            },
            Input: { ImportJobId: 'job-id' }
        };
        const lambda = require('../import-users');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            result: {
                ImportJobStatus: 'Succeeded',
                ImportJobId: 'job-id',
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

    it('Throws an error if the user pool id is not supplied', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: '' } }
            }
        };

        const lambda = require('../import-users');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to determine the new user pool ID');
    });
});
