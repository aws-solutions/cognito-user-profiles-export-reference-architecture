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
const mockSSM = {
    putParameter: jest.fn(),
    getParameter: jest.fn(),
    deleteParameter: jest.fn()
};

const mockCognitoISP = {
    describeUserPool: jest.fn()
};

jest.mock('aws-sdk', () => {
    return {
        CognitoIdentityServiceProvider: jest.fn(() => ({
            describeUserPool: mockCognitoISP.describeUserPool
        })),
        SSM: jest.fn(() => ({
            putParameter: mockSSM.putParameter,
            getParameter: mockSSM.getParameter,
            deleteParameter: mockSSM.deleteParameter
        }))
    };
});

const CustomResourceHelperFunctions = require('../../utils/custom-resource-helper-functions');
jest.mock('../../utils/custom-resource-helper-functions');

describe('stack-checker', function () {
    beforeEach(() => {
        process.env.AWS_REGION = 'us-east-1';
        process.env.FIXED_PARAMETERS = 'SecondaryRegion,PrimaryUserPoolId,BackupTableName,AnonymousDataUUID,ParentStackName,PrimaryRegion,ImportNewUsersQueueNamePrefix,SolutionInstanceUUID,UserImportJobMappingFileBucketPrefix';
        for (const mockFn in mockCognitoISP) {
            mockCognitoISP[mockFn].mockReset();
        }

        for (const mockFn in mockSSM) {
            mockSSM[mockFn].mockReset();
        }
    });

    it('Create: Handles supported user pool without errors', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id'
            }
        };

        mockCognitoISP.describeUserPool.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        UserPool: {
                            MfaConfiguration: 'OFF',
                            UsernameAttributes: ['email']
                        }
                    });
                }
            };
        });

        mockSSM.putParameter.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            return await handleCreate(evt);
        });

        const lambda = require('../stack-checker');
        await lambda.handler(event, context);
    });

    it('Create: Throws an error if the SecondaryRegion matches the primary', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'user-pool-id',
                SecondaryRegion: 'us-east-1'
            }
        };

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            return await handleCreate(evt);
        });

        const lambda = require('../stack-checker');
        try {
            await lambda.handler(event, context);
        } catch (err) {
            expect(err.message).toBe('The backup region must be different than the primary');
        }
    });

    it('Create: Throws an error if MFA is enabled', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'user-pool-id-a'
            }
        };

        mockCognitoISP.describeUserPool.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        UserPool: {
                            MfaConfiguration: 'OPTIONAL',
                            UsernameAttributes: ['email']
                        }
                    });
                }
            };
        });


        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            await handleCreate(evt);
        });

        const lambda = require('../stack-checker');
        await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('User Pools with MFA enabled are not supported. The user pool\'s MFA configuration is set to OPTIONAL');
    });

    it('Create: Throws an error if more than one username attributes are configured', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'user-pool-id-a'
            }
        };

        mockCognitoISP.describeUserPool.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        UserPool: {
                            MfaConfiguration: 'OFF',
                            UsernameAttributes: ['email', 'phone_number']
                        }
                    });
                }
            };
        });


        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            await handleCreate(evt);
        });

        const lambda = require('../stack-checker');
        await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('This solution does not support user pools for which more than one username attribute is allowed. Configured username attributes: ["email","phone_number"]');
    });

    it('Update: Handles without errors if parameters match', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id',
                SecondaryRegion: 'us-east-1'
            }
        };

        mockSSM.getParameter.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Parameter: {
                            Value: JSON.stringify({
                                PrimaryUserPoolId: 'primary-user-pool-id',
                                SecondaryRegion: 'us-east-1'
                            })
                        }
                    });
                }
            };
        });

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate, handleUpdate) => {
            return await handleUpdate(evt);
        });

        const lambda = require('../stack-checker');
        await lambda.handler(event, context);
    });

    it('Update: Throws an error if a parameter doesn\'t match', async function () {
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id',
                SecondaryRegion: 'us-east-1'
            }
        };

        mockSSM.getParameter.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Parameter: {
                            Value: JSON.stringify({
                                PrimaryUserPoolId: 'original-user-pool-id',
                                SecondaryRegion: 'us-east-1'
                            })
                        }
                    });
                }
            };
        });

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate, handleUpdate) => {
            return await handleUpdate(evt);
        });

        const lambda = require('../stack-checker');
        try {
            await lambda.handler(event, context);
        } catch (err) {
            expect(err.message).toBe('Value for CloudFormation parameter "PrimaryUserPoolId" cannot be changed. Please relaunch the solution if you need to change this value');
        }
    });

    it('Delete: Handles without errors if parameters match', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id',
                SecondaryRegion: 'us-east-1'
            }
        };

        mockSSM.deleteParameter.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate, handleUpdate, handleDelete) => {
            return await handleDelete(evt);
        });

        const lambda = require('../stack-checker');
        await lambda.handler(event, context);
    });

    it('Delete: Handles without errors if ParameterNotFound', async function () {
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id',
                SecondaryRegion: 'us-east-1'
            }
        };

        mockSSM.deleteParameter.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.reject({ code: 'ParameterNotFound' });
                }
            };
        });

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate, handleUpdate, handleDelete) => {
            return await handleDelete(evt);
        });

        const lambda = require('../stack-checker');
        await lambda.handler(event, context);
    });

    it('Delete: Throws an exception if an unexpected error occurs', async function () {
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id',
                SecondaryRegion: 'us-east-1'
            }
        };

        mockSSM.deleteParameter.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.reject({ code: 'UnexpectedError' });
                }
            };
        });

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate, handleUpdate, handleDelete) => {
            return await handleDelete(evt);
        });

        const lambda = require('../stack-checker');
        try {
            await lambda.handler(event, context);
        } catch (err) {
            expect(err.code).toBe('UnexpectedError');
        }
    });
});