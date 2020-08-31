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

// Mock axios
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
let axiosMock = new MockAdapter(axios);

// Mock AWS SDK
const mockSSM = {
    getParameter: jest.fn()
};

jest.mock('aws-sdk', () => {
    return {
        SSM: jest.fn(() => ({
            getParameter: mockSSM.getParameter
        }))
    };
});

const CustomResourceHelperFunctions = require('../../utils/custom-resource-helper-functions');
jest.mock('../../utils/custom-resource-helper-functions');

describe('stackset-manager', function () {
    beforeEach(() => {
        process.env.AWS_REGION = 'us-east-1';
        process.env.STATE_MACHINE_ARN = 'state-machine-arn';
        for (const mockFn in mockSSM) {
            mockSSM[mockFn].mockReset();
        }
        axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
        axiosMock.restore();
    });

    it('Should return the values retrieved from SSM', async function () {
        // Mock event data
        const event = {
            RequestType: 'Create',
            StackId: 'CFN_STACK_ID',
            RequestId: '02f6b8db-835e-4a83-b338-520f642e8f97',
            LogicalResourceId: 'SolutionConstants',
            ResponseURL: '/cfn-response',
            ResourceProperties: {
                ParentStackName: 'parent-stack-name',
                PrimaryRegion: 'us-east-1'
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

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            return await handleCreate(evt);
        });

        const lambda = require('../stackset-constants');
        const result = await lambda.handler(event, context);
        expect(result).toEqual({
            PrimaryUserPoolId: 'primary-user-pool-id',
            SecondaryRegion: 'us-east-1'
        });
    });

});
