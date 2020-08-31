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

const mockCfn = {
    listStackSetOperationResults: jest.fn(),
    deleteStackSet: jest.fn()
};

jest.mock('aws-sdk', () => {
    return {
        SSM: jest.fn(() => ({
            getParameter: mockSSM.getParameter
        })),
        CloudFormation: jest.fn(() => ({
            listStackSetOperationResults: mockCfn.listStackSetOperationResults,
            deleteStackSet: mockCfn.deleteStackSet
        }))
    };
});

describe('check-stackset-status', function () {
    beforeEach(() => {
        process.env.AWS_REGION = 'us-east-1';
        process.env.STATE_MACHINE_ARN = 'state-machine-arn';
        for (const mockFn in mockSSM) {
            mockSSM[mockFn].mockReset();
        }
        for (const mockFn in mockCfn) {
            mockCfn[mockFn].mockReset();
        }
        axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
        axiosMock.restore();
    });

    it('Should return an error if a stackset instance failed', async function () {
        axiosMock.onPut().reply(200);

        // Mock event data
        const event = {
            Context: {
                Execution: {
                    Input: {
                        customResourceStartTime: new Date().getTime(),
                        operationId: 'op-id',
                        customResourceEvent: {
                            RequestType: 'Create',
                            ResourceProperties: { StackSetName: 'stackset-name' }
                        }
                    }
                }
            }
        };

        mockCfn.listStackSetOperationResults.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Summaries:[{
                            Status: 'FAILED'
                        }]
                    });
                }
            };
        });


        const lambda = require('../check-stackset-status');
        await lambda.handler(event, context);
        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'FAILED',
            Reason: 'See the details in CloudWatch Log Stream: log-stream',
            Data: {
                Error: 'At least one instance in this StackSet failed to update'
            }
        })
    });

    it('Should return an error if a stackset instance was canceled', async function () {
        axiosMock.onPut().reply(200);

        // Mock event data
        const event = {
            Context: {
                Execution: {
                    Input: {
                        customResourceStartTime: new Date().getTime(),
                        operationId: 'op-id',
                        customResourceEvent: {
                            RequestType: 'Create',
                            ResourceProperties: { StackSetName: 'stackset-name' }
                        }
                    }
                }
            }
        };

        mockCfn.listStackSetOperationResults.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Summaries:[{
                            Status: 'CANCELLED'
                        }]
                    });
                }
            };
        });


        const lambda = require('../check-stackset-status');
        await lambda.handler(event, context);
        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'FAILED',
            Reason: 'See the details in CloudWatch Log Stream: log-stream',
            Data: {
                Error: 'At least one instance update was canceled'
            }
        })
    });

    it('Should return with no errors if an update is pending', async function () {
        axiosMock.onPut().reply(200);

        // Mock event data
        const event = {
            Context: {
                Execution: {
                    Input: {
                        customResourceStartTime: new Date().getTime(),
                        operationId: 'op-id',
                        customResourceEvent: {
                            RequestType: 'Create',
                            ResourceProperties: { StackSetName: 'stackset-name' }
                        }
                    }
                }
            }
        };

        mockCfn.listStackSetOperationResults.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Summaries:[{
                            Status: 'PENDING'
                        }]
                    });
                }
            };
        });


        const lambda = require('../check-stackset-status');
        await lambda.handler(event, context);
    });

    it('Should return SUCCESS if all instances were successful', async function () {
        axiosMock.onPut().reply(200);

        // Mock event data
        const event = {
            Context: {
                Execution: {
                    Input: {
                        customResourceStartTime: new Date().getTime(),
                        operationId: 'op-id',
                        customResourceEvent: {
                            RequestType: 'Create',
                            ResourceProperties: { StackSetName: 'stackset-name' }
                        }
                    }
                }
            }
        };

        mockCfn.listStackSetOperationResults.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Summaries:[{
                            Status: 'SUCCEEDED'
                        }]
                    });
                }
            };
        });


        const lambda = require('../check-stackset-status');
        await lambda.handler(event, context);
        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream',
            Data: {
                Message: 'Create Successful'
            }
        })
    });

    it('Should return SUCCESS if all instances were successfully deleted', async function () {
        axiosMock.onPut().reply(200);

        // Mock event data
        const event = {
            Context: {
                Execution: {
                    Input: {
                        customResourceStartTime: new Date().getTime(),
                        operationId: 'op-id',
                        customResourceEvent: {
                            RequestType: 'Delete',
                            ResourceProperties: { StackSetName: 'stackset-name' }
                        }
                    }
                }
            }
        };

        mockCfn.listStackSetOperationResults.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Summaries:[{
                            Status: 'SUCCEEDED'
                        }]
                    });
                }
            };
        });

        mockCfn.deleteStackSet.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        const lambda = require('../check-stackset-status');
        await lambda.handler(event, context);
        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream',
            Data: {
                Message: 'Delete Successful'
            }
        })
    });
});
