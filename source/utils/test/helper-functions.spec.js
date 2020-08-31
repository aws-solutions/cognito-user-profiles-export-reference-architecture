// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */
const HelperFunctions = require('../../utils/helper-functions');

describe('utils/helper-functions', () => {
    beforeEach(() => {
        process.env.SOLUTION_ID = 'SOMOCK';
        process.env.SOLUTION_VERSION = 'v1.0.0';
        process.env.AWS_REGION = 'us-east-1';
        process.env.IS_SECONDARY_REGION = 'No';
    });

    test('getFunctionData', async function () {
        expect(() => {
            HelperFunctions.getFunctionData();
        }).toThrow('Error validating Environment Variables. Must pass an array as requiredProperties');

        expect(() => {
            HelperFunctions.getFunctionData([]);
        }).toThrow('Error validating Event Payload. Must pass an array as requiredProperties');

        expect(() => {
            HelperFunctions.getFunctionData(['UNKNOWN_ENV_VAR'], [], [], {});
        }).toThrow('Error validating Environment Variables. Missing value for UNKNOWN_ENV_VAR');

        expect(() => {
            HelperFunctions.getFunctionData([], ['MISSING_PROPERTY'], [], {});
        }).toThrow('Error validating Event Payload. Missing value for MISSING_PROPERTY');

        let result = HelperFunctions.getFunctionData(
            ['SOLUTION_ID', 'AWS_REGION'],
            ['REQUIRED_PROPERTY'],
            ['OPTIONAL_PROPERTY'],
            { REQUIRED_PROPERTY: 'value' });

        expect(result).toEqual({
            SOLUTION_ID: 'SOMOCK',
            AWS_REGION: 'us-east-1',
            REQUIRED_PROPERTY: 'value'
        });

        result = HelperFunctions.getFunctionData(
            ['SOLUTION_ID', 'AWS_REGION'],
            ['REQUIRED_PROPERTY'],
            ['OPTIONAL_PROPERTY'],
            { REQUIRED_PROPERTY: 'value', OPTIONAL_PROPERTY: 'value2' });

        expect(result).toEqual({
            SOLUTION_ID: 'SOMOCK',
            AWS_REGION: 'us-east-1',
            REQUIRED_PROPERTY: 'value',
            OPTIONAL_PROPERTY: 'value2'
        });
    });

    test('objHasProperties', async function () {
        expect(() => {
            HelperFunctions.objHasProperties({}, 'not-an-array', 'test-object-type');
        }).toThrow('Error validating test-object-type. Must pass an array as requiredProperties');

        expect(() => {
            HelperFunctions.objHasProperties({ propertyName: '' }, ['propertyName'], 'test-object-type');
        }).toThrow('Error validating test-object-type. Missing value for propertyName');

        expect(() => {
            HelperFunctions.objHasProperties({ propertyName: 'value' }, [''], 'test-object-type');
        }).toThrow('Error validating test-object-type. Must only pass non-empty strings in the requiredProperties array');

        expect(() => {
            HelperFunctions.objHasProperties({ propertyName: ' ' }, ['propertyName'], 'test-object-type');
        }).toThrow('Error validating test-object-type. Value for propertyName must not be only whitespace');
    });

    test('appendToStrWithMaxChar', async function () {
        let result = HelperFunctions.appendToStrWithMaxChar();
        expect(result).toBe('');

        result = HelperFunctions.appendToStrWithMaxChar('a-long-sqs-fifo-queue-name', '.fifo', 10);
        expect(result).toBe('a-lon.fifo');
    });

    test('sleep', async function () {
        const start = Date.now();
        await HelperFunctions.sleep(2, 500);
        const sleepTime = Date.now() - start;

        expect(sleepTime).toBeGreaterThanOrEqual(2500);
        expect(sleepTime).toBeLessThan(2600);
    });

    test('getExponentialBackoffTimeInMS', async function () {
        let result = HelperFunctions.getExponentialBackoffTimeInMS(0, 0, 0);
        expect(result).toEqual(0);

        result = HelperFunctions.getExponentialBackoffTimeInMS(100, 100, 1000);
        expect(result).toEqual(1000);

        result = HelperFunctions.getExponentialBackoffTimeInMS(100, 2, 1000);
        expect(result).toEqual(400);

        result = HelperFunctions.getExponentialBackoffTimeInMS(100, 100, 1000, true);
        expect(result).toBeLessThanOrEqual(1000);
        expect(result).toBeGreaterThanOrEqual(1);
    });
});