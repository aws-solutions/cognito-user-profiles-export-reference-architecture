// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */
const { sendAnonymousMetric, getOptions } = require('../../utils/metrics');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

describe('utils/metrics', () => {
    const OLD_ENV = process.env;
    let axiosMock;

    beforeEach(() => {
        axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
        axiosMock.restore();
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    it('Should run normally', async function () {
        expect.assertions(6);

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

        expect(metricReq.url).toBe('https://metrics.awssolutionsbuilder.com/generic');
        expect(metricPayload.TimeStamp).toMatch(timestampRegex);
        expect(metricPayload.Solution).toBe(SOLUTION_ID);
        expect(metricPayload.UUID).toBe(METRICS_ANONYMOUS_UUID);
        expect(metricPayload.Version).toBe(SOLUTION_VERSION);
        expect(metricPayload.Data).toEqual(metricData);
    });
});

describe('utils/getOptions', () => {
    const OLD_ENV = process.env;

    afterAll(() => {
        process.env = OLD_ENV;
    });

    it('Should return the correct user agent string in the options object', async function () {
        expect.assertions(1);

        const optionsResp = getOptions();
        expect(optionsResp).toEqual({
            customUserAgent: [['AWSSOLUTION/SOMOCK','v1.0.0']]
        });
    });

    it('Should return the existing options, plus the user agent string', async function () {
        expect.assertions(1);

        const optionsResp = getOptions({ region: process.env.AWS_REGION });

        expect(optionsResp).toEqual({
            customUserAgent: [['AWSSOLUTION/SOMOCK','v1.0.0']],
            region: 'us-east-1'
        });
    });

    test('Test sending empty object as existing options', async function () {
        expect.assertions(1);

        const optionsResp = getOptions({});

        expect(optionsResp).toEqual({
            customUserAgent: [['AWSSOLUTION/SOMOCK','v1.0.0']]
        });
    });

    test('Test getOptions() does not overwrite the existing customUserAgent', async function () {
        expect.assertions(1);

        const optionsResp = getOptions({
            customUserAgent: [['Previous/User','Agent']],
            region: process.env.AWS_REGION
        });

        expect(optionsResp).toEqual({
            customUserAgent: [['Previous/User','Agent']],
            region: 'us-east-1'
        });
    });

    test('Solution version is not present', async function () {
        expect.assertions(1);

        delete process.env.SOLUTION_VERSION;

        const optionsResp = getOptions();

        expect(optionsResp).toEqual({});
    });

    test('Solution version is whitespace', async function () {
        expect.assertions(1);

        process.env.SOLUTION_VERSION = '  ';

        const optionsResp = getOptions();

        expect(optionsResp).toEqual({});
    });

    test('Solution ID is not present', async function () {
        expect.assertions(1);

        delete process.env.SOLUTION_ID;

        const optionsResp = getOptions();

        expect(optionsResp).toEqual({});
    });

    test('Solution ID is whitespace', async function () {
        expect.assertions(1);

        process.env.SOLUTION_ID = '  ';

        const optionsResp = getOptions();

        expect(optionsResp).toEqual({});
    });
});
