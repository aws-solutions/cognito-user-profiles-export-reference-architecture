// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */
const CustomResourceHelpers = require('../../utils/custom-resource-helper-functions');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

describe('utils/custom-resource-helper-functions', () => {
    let axiosMock;

    beforeEach(() => {
        axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
        axiosMock.restore();
    });

    it('Create', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPut().reply(200);

        await CustomResourceHelpers.handler({ RequestType: 'Create', LogicalResourceId: 'logical-id' }, { logStreamName: 'log-stream-name' }, (() => {
            return 'response-to-cloudformation';
        }), undefined, undefined);

        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream-name',
            LogicalResourceId: 'logical-id',
            PhysicalResourceId: 'logical-id',
            Data: {
                Message: 'response-to-cloudformation'
            }
        })
    });

    it('Update', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPut().reply(200);

        await CustomResourceHelpers.handler({ RequestType: 'Update', LogicalResourceId: 'logical-id' }, { logStreamName: 'log-stream-name' }, undefined, (() => {
            return 'response-to-cloudformation';
        }), undefined);

        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream-name',
            LogicalResourceId: 'logical-id',
            PhysicalResourceId: 'logical-id',
            Data: {
                Message: 'response-to-cloudformation'
            }
        })
    });

    it('Delete', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPut().reply(200);

        await CustomResourceHelpers.handler({ RequestType: 'Delete', LogicalResourceId: 'logical-id' }, { logStreamName: 'log-stream-name' }, undefined, undefined, (() => {
            return 'response-to-cloudformation';
        }));

        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream-name',
            LogicalResourceId: 'logical-id',
            PhysicalResourceId: 'logical-id',
            Data: {
                Message: 'response-to-cloudformation'
            }
        })
    });

    it('Returned object', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPut().reply(200);

        await CustomResourceHelpers.handler({ RequestType: 'Delete', LogicalResourceId: 'logical-id' }, { logStreamName: 'log-stream-name' }, undefined, undefined, (() => {
            return { key: 'value' };
        }));

        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream-name',
            LogicalResourceId: 'logical-id',
            PhysicalResourceId: 'logical-id',
            Data: {
                key: 'value'
            }
        })
    });

    it('Unexpected', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPut().reply(200);

        await CustomResourceHelpers.handler({ RequestType: 'Unexpected', LogicalResourceId: 'logical-id' }, { logStreamName: 'log-stream-name' }, undefined, undefined, undefined);

        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'SUCCESS',
            Reason: 'See the details in CloudWatch Log Stream: log-stream-name',
            LogicalResourceId: 'logical-id',
            PhysicalResourceId: 'logical-id',
            Data: {
                Message: 'No action required for Unexpected'
            }
        })
    });

    it('Failure', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPut().reply(200);

        await CustomResourceHelpers.handler({ RequestType: 'Create', LogicalResourceId: 'logical-id' }, { logStreamName: 'log-stream-name' }, (() => {
            throw new Error('unexpected error while handling create');
        }), undefined, undefined);

        const cfnReq = axiosMock.history.put[0];
        console.log(cfnReq)
        expect(JSON.parse(cfnReq.data)).toEqual({
            Status: 'FAILED',
            Reason: 'See the details in CloudWatch Log Stream: log-stream-name',
            LogicalResourceId: 'logical-id',
            PhysicalResourceId: 'logical-id',
            Data: {
                Error: 'unexpected error while handling create'
            }
        })
    });
});