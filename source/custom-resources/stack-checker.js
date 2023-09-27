// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');

const { CognitoIdentityProviderClient, DescribeUserPoolCommand } = require("@aws-sdk/client-cognito-identity-provider"),
      {
          SSM
      } = require("@aws-sdk/client-ssm");
const ssm = new SSM(getOptions());
const cognitoClient = new CognitoIdentityProviderClient(getOptions());
const CustomResourceHelperFunctions = require('../utils/custom-resource-helper-functions');
const { AWS_REGION, FIXED_PARAMETERS } = process.env;
const fixedParameters = FIXED_PARAMETERS.split(',');

/**
 * Custom Resource that checks to see if the current stack update is supported
 */
exports.handler = async (event, context) => {
    return await CustomResourceHelperFunctions.handler(event, context, handleCreate, handleUpdate, handleDelete);
};

/**
 * Stores the values of the solution's fixed parameters in SSM Parameter Store so they can be referenced later in the event of a stack update
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const handleCreate = async function putSSMParameters(event) {
    const resourceProperties = event.ResourceProperties;

    // Make sure the secondary region is not the same as the primary region
    if (resourceProperties.SecondaryRegion === AWS_REGION) {
        throw new Error('The backup region must be different than the primary');
    }

    // Check to make sure the primary user pool has a supported configuration
    await checkUserPoolConfig(resourceProperties.PrimaryUserPoolId);

    const ssmParameterName = `/${resourceProperties.ParentStackName}-${AWS_REGION}/fixed-solution-parameters`;
    const putParams = {
        Type: 'String',
        Name: ssmParameterName,
        Value: JSON.stringify(fixedParameters.reduce((obj, fixedParam) => {
            return { ...obj, [fixedParam]: resourceProperties[fixedParam] };
        }, {}))
    };

    console.log(`Putting parameter: ${JSON.stringify(putParams)}`);
    const putResponse = await ssm.putParameter(putParams);
    console.log(`Put response: ${JSON.stringify(putResponse)}`);
};

/**
 * Retrieves values for each of the solution's fixed parameters from SSM Parameter Store and checks to make sure they have not changed in the stack update
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const handleUpdate = async function checkCurrentPropertiesAgainstSSM(event) {
    const resourceProperties = event.ResourceProperties;
    const ssmParameterName = `/${resourceProperties.ParentStackName}-${AWS_REGION}/fixed-solution-parameters`;
    const getParams = { Name: ssmParameterName };

    console.log(`Getting parameter: ${JSON.stringify(getParams)}`);
    const getResponse = await ssm.getParameter(getParams);
    console.log(`Get response: ${JSON.stringify(getResponse)}`);

    const parametersFromSSM = JSON.parse(getResponse.Parameter.Value);

    fixedParameters.forEach(parameterName => {
        console.log(`Checking parameter "${parameterName}"`);
        if (resourceProperties[parameterName] !== parametersFromSSM[parameterName]) {
            throw new Error(`Value for CloudFormation parameter "${parameterName}" cannot be changed. Please relaunch the solution if you need to change this value`);
        }
    });

    console.log('All parameters checked OK');
};

/**
 * Removes the solution's fixed parameters from SSM Parameter Store when the solution is deleted
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const handleDelete = async function deleteSSMParameters(event) {
    const resourceProperties = event.ResourceProperties;
    const ssmParameterName = `/${resourceProperties.ParentStackName}-${AWS_REGION}/fixed-solution-parameters`;

    try {
        const deleteParams = { Name: ssmParameterName };
        console.log(`Deleting parameters: ${JSON.stringify(deleteParams)}`);
        const deleteResponse = await ssm.deleteParameter(deleteParams);
        console.log(`Delete response: ${JSON.stringify(deleteResponse)}`);
    } catch (err) {
        if (err.name === 'ParameterNotFound') {
            console.log(`Parameter ${ssmParameterName} is not present in SSM`);
        } else {
            throw err;
        }
    }
};

/**
 * Throws an Error if the supplied Cognito user pool has a configuration that is not supported by this solution
 * @param {string} UserPoolId The ID of the user pool that should be evaluated
 */
const checkUserPoolConfig = async (UserPoolId) => {
    const describeUserPoolParams = { UserPoolId };
    console.log(`Describing user pool: ${JSON.stringify(describeUserPoolParams)}`);
    const describeUserPoolResponse = await cognitoClient.send(new DescribeUserPoolCommand(describeUserPoolParams));
    console.log(`Describe user pool response: ${JSON.stringify(describeUserPoolResponse, null, 2)}`);

    if (describeUserPoolResponse.UserPool.MfaConfiguration && describeUserPoolResponse.UserPool.MfaConfiguration !== 'OFF') {
        throw new Error(`User Pools with MFA enabled are not supported. The user pool\'s MFA configuration is set to ${describeUserPoolResponse.UserPool.MfaConfiguration}`);
    }

    if (describeUserPoolResponse.UserPool.UsernameAttributes) {
        if (describeUserPoolResponse.UserPool.UsernameAttributes.length > 1) {
            throw new Error(`This solution does not support user pools for which more than one username attribute is allowed. Configured username attributes: ${JSON.stringify(describeUserPoolResponse.UserPool.UsernameAttributes)}`);
        }
    }
};
