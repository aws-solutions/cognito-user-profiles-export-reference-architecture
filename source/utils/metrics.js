// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const axios = require('axios');
const moment = require('moment');

/**
 * Client for sending anonymized operational metrics
 * @param {string} solutionId The ID for this solution
 * @param {string} solutionVersion The version of this solution
 * @param {string} solutionUUID The anonymous ID for this instance of the solution, generated at launch
 * @param {object} jsonData Anonymized metric payload
 */
exports.sendAnonymousMetric = async (solutionId, solutionVersion, solutionUUID, jsonData) => {
    try {
        const metricData = {
            Solution: solutionId,
            Version: solutionVersion,
            UUID: solutionUUID,
            TimeStamp: moment().utc().toISOString(),
            Data: jsonData
        };

        const params = {
            method: 'post',
            port: 443,
            url: 'https://metrics.awssolutionsbuilder.com/generic',
            headers: { 'Content-Type': 'application/json' },
            data: metricData
        };

        console.log(`Sending anonymized metric: ${JSON.stringify(metricData)}`);
        const response = await axios(params);
        console.log(`Anonymized metric send response status: ${response.status}`);
    } catch (err) {
        console.error(err);
    }
};

/**
 * If the solution ID and version environment variables are set, this will return 
 * an object with a custom user agent string. Otherwise, the object returned will be empty
 */
exports.getOptions = (existingOptions = {}) => {
    const { SOLUTION_ID, SOLUTION_VERSION } = process.env;
    const options = {};

    if (SOLUTION_ID && SOLUTION_VERSION) {
        if (SOLUTION_ID.trim() !== '' && SOLUTION_VERSION.trim() !== '') {
            options.customUserAgent = [[`AWSSOLUTION/${SOLUTION_ID}`,`${SOLUTION_VERSION}`]];
        }
    }

    return Object.assign(options, existingOptions);
}