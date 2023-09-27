// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { mockClient } = require('aws-sdk-client-mock');
const {
    CognitoIdentityProviderClient, DescribeUserPoolCommand
} = require("@aws-sdk/client-cognito-identity-provider"),
{
    SSMClient, PutParameterCommand, GetParameterCommand, DeleteParameterCommand, ParameterNotFound, InternalServerError
} = require("@aws-sdk/client-ssm");

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

const mockSSM = mockClient(SSMClient);
const mockCognito = mockClient(CognitoIdentityProviderClient);

const CustomResourceHelperFunctions = require('../../utils/custom-resource-helper-functions');
jest.mock('../../utils/custom-resource-helper-functions');

describe('stack-checker', function () {
    beforeEach(() => {
        process.env.AWS_REGION = 'us-east-1';
        process.env.FIXED_PARAMETERS = 'SecondaryRegion,PrimaryUserPoolId,BackupTableName,AnonymousDataUUID,ParentStackName,PrimaryRegion,ImportNewUsersQueueNamePrefix,SolutionInstanceUUID,UserImportJobMappingFileBucketPrefix';
        mockSSM.reset();
        mockCognito.reset();
    });

    it('Create: Handles supported user pool without errors', async function () {
        // Mock event data
        const event = {
            ResourceProperties: {
                StackName: 'stack-name',
                PrimaryUserPoolId: 'primary-user-pool-id'
            }
        };

        mockCognito.on(DescribeUserPoolCommand).resolvesOnce({
            UserPool: {
                MfaConfiguration: 'OFF',
                UsernameAttributes: ['email']
            }
        })

        mockSSM.on(PutParameterCommand).resolvesOnce({});
        

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

        mockCognito.on(DescribeUserPoolCommand).resolvesOnce({
            UserPool: {
                MfaConfiguration: 'OPTIONAL',
                UsernameAttributes: ['email']
            }
        })


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

        mockCognito.on(DescribeUserPoolCommand).resolvesOnce({
            UserPool: {
                MfaConfiguration: 'OFF',
                UsernameAttributes: ['email', 'phone_number']
            }
        })


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

        mockSSM.on(GetParameterCommand).resolvesOnce({
            Parameter: {
                Value: JSON.stringify({
                    PrimaryUserPoolId: 'primary-user-pool-id',
                    SecondaryRegion: 'us-east-1'
                })
            }
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

        mockSSM.on(GetParameterCommand).resolvesOnce({
            Parameter: {
                Value: JSON.stringify({
                    PrimaryUserPoolId: 'original-user-pool-id',
                    SecondaryRegion: 'us-east-1'
                })
            }
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

        mockSSM.on(DeleteParameterCommand).resolvesOnce({});

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

        mockSSM.on(DeleteParameterCommand).rejectsOnce(new ParameterNotFound());

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

        mockSSM.on(DeleteParameterCommand).rejectsOnce(new InternalServerError({message: 'test error'}));

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate, handleUpdate, handleDelete) => {
            return await handleDelete(evt);
        });

        const lambda = require('../stack-checker');
        try {
            await lambda.handler(event, context);
        } catch (err) {
            expect(err.name).toBe('InternalServerError');
        }
    });
});