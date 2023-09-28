// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const { PRIMARY_USER_POOL_ID } = process.env;

const {
    CognitoIdentityProvider: CognitoIdentityServiceProvider
} = require("@aws-sdk/client-cognito-identity-provider");
const cognitoISP = new CognitoIdentityServiceProvider(getOptions());

/**
 * Checks the configuration of the primary user pool to ensure it is supported by the solution
 * @param {object} event
 */
exports.handler = async (event) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const result = {};

    const describeUserPoolParams = { UserPoolId: PRIMARY_USER_POOL_ID };
    console.log(`Describing user pool: ${JSON.stringify(describeUserPoolParams)}`);
    const describeUserPoolResponse = await cognitoISP.describeUserPool(describeUserPoolParams);
    console.log(`Describe user pool response: ${JSON.stringify(describeUserPoolResponse, null, 2)}`);

    if (describeUserPoolResponse.UserPool.MfaConfiguration && describeUserPoolResponse.UserPool.MfaConfiguration !== 'OFF') {
        throw new Error(`User Pools with MFA enabled are not supported. The user pool\'s MFA configuration is set to ${describeUserPoolResponse.UserPool.MfaConfiguration}`);
    }

    if (describeUserPoolResponse.UserPool.UsernameAttributes) {
        if (describeUserPoolResponse.UserPool.UsernameAttributes.length > 1) {
            throw new Error(`This solution does not support user pools for which more than one username attribute is allowed. Configured username attributes: ${JSON.stringify(describeUserPoolResponse.UserPool.UsernameAttributes)}`);
        }
        result.UsernameAttributes = JSON.stringify(describeUserPoolResponse.UserPool.UsernameAttributes);
    }

    console.log(`Result: ${JSON.stringify(result)}`);
    return { result: result };
};
