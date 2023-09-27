// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const CustomResourceHelperFunctions = require('../utils/custom-resource-helper-functions');
const {
 SSM
} = require("@aws-sdk/client-ssm");

/**
 * Retrieves solutions constants from SSM parameter store so they can be used within the StackSet instance
 */
exports.handler = async (event, context) => {
    return await CustomResourceHelperFunctions.handler(event, context, handleCreate);
};

/**
 * Retrieves the Solution Constants from SSM Parameter Store and makes them available to the StackSet
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const handleCreate = async function handleCreate(event) {
    const { ParentStackName, PrimaryRegion } = event.ResourceProperties;
    const ssm = new SSM(getOptions({ region: PrimaryRegion }));
    const ssmParameterName = `/${ParentStackName}-${PrimaryRegion}/fixed-solution-parameters`;
    const getParams = { Name: ssmParameterName };

    console.log(`Getting parameter: ${JSON.stringify(getParams)}`);
    const getResponse = await ssm.getParameter(getParams);
    console.log(`Get response: ${JSON.stringify(getResponse)}`);

    const parametersFromSSM = JSON.parse(getResponse.Parameter.Value);

    return parametersFromSSM;
};
