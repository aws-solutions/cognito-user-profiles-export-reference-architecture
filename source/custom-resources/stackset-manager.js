// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
          CloudFormation
      } = require("@aws-sdk/client-cloudformation"),
      {
          SFN: StepFunctions
      } = require("@aws-sdk/client-sfn");
const cfn = new CloudFormation(getOptions());
const stepFunctions = new StepFunctions(getOptions());
const axios = require('axios');
const { AWS_REGION, STATE_MACHINE_ARN } = process.env;

// Values for sending anonymized metrics
const { SEND_METRIC, METRICS_ANONYMOUS_UUID, SOLUTION_ID, SOLUTION_VERSION, COGNITO_TPS, EXPORT_FREQUENCY, SNS_PREFERENCE } = process.env;
const { sendAnonymousMetric } = require('../utils/metrics');

/**
 * Manages the solution's StackSet during solution create/update/deletes 
 * @param {object} event
 * @param {object} context
 * @return {Promise<object>}
 */
exports.handler = async (event, context) => {
    console.log(`Received event: ${JSON.stringify(event)}`);
    const customResourceStartTime = new Date().getTime();
    let operationId;

    try {
        switch (event.RequestType) {
            case 'Create':
                await createStackSet(event);
                operationId = await createStackInstances(event);
                break;
            case 'Update':
                operationId = await updateStackSet(event);
                break;
            case 'Delete':
                operationId = await deleteStackInstances(event);
                break;
        }

        // Start the Step Functions state machine that will check the StackSet status and respond to CloudFormation
        const startExecutionParams = {
            stateMachineArn: STATE_MACHINE_ARN,
            input: JSON.stringify({
                customResourceStartTime,
                operationId,
                customResourceEvent: event
            })
        };
        console.log(`Starting State Machine execution: ${JSON.stringify(startExecutionParams)}`);
        const startExecutionResponse = await stepFunctions.startExecution(startExecutionParams);
        console.log(`State machine started: ${JSON.stringify(startExecutionResponse)}`);

        // If enabled, send anonymized metric
        if (SEND_METRIC === 'Yes') {
            try {
                const payload = {
                    EventType: `Solution-${event.RequestType}`,
                    EventDetails: {
                        Region: AWS_REGION,
                        CognitoTPS: COGNITO_TPS,
                        SnsPreference: SNS_PREFERENCE,
                        ExportFrequency: EXPORT_FREQUENCY
                    }
                };

                await sendAnonymousMetric(SOLUTION_ID, SOLUTION_VERSION, METRICS_ANONYMOUS_UUID, payload);
            } catch (err) {
                console.error(err);
            }
        }
    } catch (error) {
        console.error(error);
        const response = {
            status: 'FAILED',
            data: { Error: error.message }
        };

        await sendResponse(event, context.logStreamName, response);

        return response;
    }

    return event;
}

/**
 * Creates the solution's StackSet
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const createStackSet = async function createStackSet(event) {
    const { StackSetName, StackSetParameters, TemplateURL, AdministrationRoleARN, ExecutionRoleName } = event.ResourceProperties;
    const params = {
        StackSetName: StackSetName,
        TemplateURL: TemplateURL,
        AdministrationRoleARN: AdministrationRoleARN,
        ExecutionRoleName: ExecutionRoleName,
        Capabilities: ['CAPABILITY_IAM'],
        Parameters: Object.keys(StackSetParameters).map(paramKey => {
            return { ParameterKey: paramKey, ParameterValue: StackSetParameters[paramKey] };
        })
    };

    console.log(`Creating StackSet: ${JSON.stringify(params)}`);
    const response = await cfn.createStackSet(params);
    console.log(`Create StackSet Response: ${JSON.stringify(response)}`);
};

/**
 * Creates instances of the solution's StackSet in both the primary and backup regions
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const createStackInstances = async function createStackInstances(event) {
    const { StackSetName, AccountId } = event.ResourceProperties;
    const { SecondaryRegion } = event.ResourceProperties;
    const params = {
        StackSetName: StackSetName,
        Accounts: [AccountId],
        Regions: [SecondaryRegion, AWS_REGION]
    }

    console.log(`Creating StackSet Instance: ${JSON.stringify(params)}`);
    const response = await cfn.createStackInstances(params);
    console.log(`Create StackSet Instance Response: ${JSON.stringify(response)}`);
    return response.OperationId;
};

/**
 * Deletes the instances from the solution's StackSet
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const deleteStackInstances = async function deleteStackInstances(event) {
    const { StackSetName, AccountId } = event.ResourceProperties;
    const { SecondaryRegion } = event.ResourceProperties;
    const params = {
        StackSetName: StackSetName,
        Accounts: [AccountId],
        Regions: [SecondaryRegion, AWS_REGION],
        RetainStacks: false
    }

    console.log(`Deleting Stack Instances: ${JSON.stringify(params)}`);
    const response = await cfn.deleteStackInstances(params);
    console.log(`Delete Stack Instances response: ${JSON.stringify(response)}`);
    return response.OperationId;
};

/**
 * Updates the StackSet with a new TemplateURL or parameters
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const updateStackSet = async (event) => {
    const { StackSetName, StackSetParameters, TemplateURL, AdministrationRoleARN, ExecutionRoleName } = event.ResourceProperties;
    const params = {
        StackSetName: StackSetName,
        TemplateURL: TemplateURL,
        AdministrationRoleARN: AdministrationRoleARN,
        ExecutionRoleName: ExecutionRoleName,
        Capabilities: ['CAPABILITY_IAM'],
        Parameters: Object.keys(StackSetParameters).map(paramKey => {
            return { ParameterKey: paramKey, ParameterValue: StackSetParameters[paramKey] };
        })
    };

    console.log(`Updating StackSet: ${JSON.stringify(params)}`);
    const response = await cfn.updateStackSet(params);
    console.log(`Update StackSet response: ${JSON.stringify(response)}`);
    return response.OperationId;
};

/**
 * Send custom resource response.
 * @param {object} event - Custom resource event
 * @param {string} logStreamName - Custom resource log stream name
 * @param {object} response - Response object { status: "SUCCESS|FAILED", data: object }
 */
async function sendResponse(event, logStreamName, response) {
    const responseBody = JSON.stringify({
        Status: response.status,
        Reason: `See the details in CloudWatch Log Stream: ${logStreamName}`,
        PhysicalResourceId: logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: response.data,
    });

    const config = {
        headers: {
            'Content-Type': '',
            'Content-Length': responseBody.length
        }
    };

    await axios.put(event.ResponseURL, responseBody, config);
}
