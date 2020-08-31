// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */
const { sendAnonymousMetric } = require('../../utils/metrics');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

describe('utils/metrics', () => {
    let axiosMock;

    beforeEach(() => {
        process.env.SOLUTION_ID = 'SOMOCK';
        process.env.SOLUTION_VERSION = 'v1.0.0';
        process.env.METRICS_ANONYMOUS_UUID = 'uuid';
        process.env.AWS_REGION = 'us-east-1';
        process.env.IS_SECONDARY_REGION = 'No';
        axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
        axiosMock.restore();
    });

    it('Should run normally', async function () {
        // Force the metric POST event to succeed
        axiosMock.onPost().reply(200);

        const {
            SOLUTION_ID, SOLUTION_VERSION, METRICS_ANONYMOUS_UUID,
            AWS_REGION, IS_SECONDARY_REGION } = process.env;

        const metricData = {
            EventType: 'unit-test-metric',
            EventDetails: `${AWS_REGION} (${IS_SECONDARY_REGION === 'Yes' ? 'Secondary' : 'Primary'} Region)`
        };

        await sendAnonymousMetric(SOLUTION_ID, SOLUTION_VERSION, METRICS_ANONYMOUS_UUID, metricData);

        const metricReq = axiosMock.history.post[0];
        const metricPayload = JSON.parse(metricReq.data);
        const timestampRegex = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/;

        expect(metricReq.url).toMatch('https://metrics.awssolutionsbuilder.com/generic');
        expect(metricPayload.TimeStamp).toMatch(timestampRegex);
        expect(metricPayload.Solution).toMatch(SOLUTION_ID);
        expect(metricPayload.UUID).toMatch(METRICS_ANONYMOUS_UUID);
        expect(metricPayload.Version).toMatch(SOLUTION_VERSION);
        expect(metricPayload.Data).toMatchObject(metricData);
    });
});