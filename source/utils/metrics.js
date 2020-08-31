// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const axios = require('axios');
const moment = require('moment');

/**
 * Client for sending anonymous operational metrics
 * @param {string} solutionId The ID for this solution
 * @param {string} solutionVersion The version of this solution
 * @param {string} solutionUUID The anonymous ID for this instance of the solution, generated at launch
 * @param {object} jsonData Anonymous metric payload
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

        console.log(`Sending anonymous metric: ${JSON.stringify(metricData)}`);
        const response = await axios(params);
        console.log(`Anonymous metric send response status: ${response.status}`);
    } catch (err) {
        console.error(err);
    }
};
