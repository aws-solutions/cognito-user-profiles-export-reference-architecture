// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

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

// Mock axios
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
let axiosMock = new MockAdapter(axios);

// Mock AWS SDK
const mockCfn = {
    createStackSet: jest.fn(),
    createStackInstances: jest.fn(),
    listStackInstances: jest.fn(),
    deleteStackInstances: jest.fn(),
    deleteStackSet: jest.fn(),
    updateStackSet: jest.fn()
};

const mockStepFunctions = {
    startExecution: jest.fn()
};

jest.mock('aws-sdk', () => {
    return {
        CloudFormation: jest.fn(() => ({
            createStackSet: mockCfn.createStackSet,
            createStackInstances: mockCfn.createStackInstances,
            listStackInstances: mockCfn.listStackInstances,
            deleteStackInstances: mockCfn.deleteStackInstances,
            deleteStackSet: mockCfn.deleteStackSet,
            updateStackSet: mockCfn.updateStackSet
        })),
        StepFunctions: jest.fn(() => ({
            startExecution: mockStepFunctions.startExecution
        }))
    };
});

describe('stackset-manager', function () {
    beforeEach(() => {
        process.env.AWS_REGION = 'us-east-1';
        process.env.STATE_MACHINE_ARN = 'state-machine-arn';
        process.env.SEND_METRIC = 'Yes';
        for (const mockFn in mockCfn) {
            mockCfn[mockFn].mockReset();
        }

        for (const mockFn in mockStepFunctions) {
            mockStepFunctions[mockFn].mockReset();
        }
        axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
        axiosMock.restore();
    });

    it('Create: Handled without errors', async function () {
        // Mock event data
        const event = {
            RequestType: 'Create',
            ResourceProperties: {
                StackSetName: 'stack-name',
                StackSetParameters: { Key: 'Value' },
                TemplateURL: 'template-url',
                AdministrationRoleARN: 'admin-role-arn',
                ExecutionRoleName: 'exec-role-arn'
            }
        };

        Metrics.sendAnonymousMetric.mockImplementationOnce(async (x, y, z) => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockCfn.createStackSet.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockCfn.createStackInstances.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockStepFunctions.startExecution.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        const lambda = require('../stackset-manager');
        await lambda.handler(event, context);
    }, 10000);

    it('Update: Handled without errors', async function () {
        // Mock event data
        const event = {
            RequestType: 'Update',
            ResourceProperties: {
                StackSetName: 'stack-name',
                StackSetParameters: { Key: 'Value' },
                TemplateURL: 'template-url',
                AdministrationRoleARN: 'admin-role-arn',
                ExecutionRoleName: 'exec-role-arn'
            }
        };

        mockCfn.updateStackSet.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockStepFunctions.startExecution.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        const lambda = require('../stackset-manager');
        await lambda.handler(event, context);
    }, 10000);

    it('Delete: Handled without errors', async function () {
        // Mock event data
        const event = {
            RequestType: 'Delete',
            ResourceProperties: {
                StackSetName: 'stack-name',
                StackSetParameters: {},
                TemplateURL: 'template-url',
                AdministrationRoleARN: 'admin-role-arn',
                ExecutionRoleName: 'exec-role-arn'
            }
        };

        mockCfn.deleteStackInstances.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockStepFunctions.startExecution.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        const lambda = require('../stackset-manager');
        await lambda.handler(event, context);
    }, 10000);

    it('Error: Handles error without rethrowing', async function () {
        axiosMock.onPut().reply(200);

        // Mock event data
        const event = {
            RequestType: 'Delete',
            ResourceProperties: {
                StackSetName: 'stack-name',
                StackSetParameters: {},
                TemplateURL: 'template-url',
                AdministrationRoleARN: 'admin-role-arn',
                ExecutionRoleName: 'exec-role-arn',
                ResponseURL: '/cfn-response'
            }
        };

        mockCfn.deleteStackInstances.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.reject({ message: 'an error' });
                }
            };
        });

        const lambda = require('../stackset-manager');
        await lambda.handler(event, context);
        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'FAILED',
            Reason: 'See the details in CloudWatch Log Stream: log-stream',
            PhysicalResourceId: 'log-stream',
            Data: {
                Error: 'an error'
            }
        })
    }, 10000);
});
