// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
    CloudFormation
} = require("@aws-sdk/client-cloudformation");
const cfn = new CloudFormation(getOptions());
const axios = require('axios');

/**
 * Checks the status of the solution's StackSets and when ready, responds to CloudFormation
 */
exports.handler = async (event, context) => {
    console.log(`Received event: ${JSON.stringify(event)}`);
    const { operationId } = event.Context.Execution.Input;
    const { RequestType } = event.Context.Execution.Input.customResourceEvent;
    const { StackSetName } = event.Context.Execution.Input.customResourceEvent.ResourceProperties;
    const result = { HasRespondedToCfn: false };
    try {
        if (await areAllInstancesUpdated(StackSetName, operationId)) {
            if (RequestType === 'Delete') {
                await deleteStackSet(StackSetName);
            }
            const response = {
                status: 'SUCCESS',
                data: { Message: `${RequestType} Successful` }
            };

            await sendResponse(event.Context.Execution.Input.customResourceEvent, context.logStreamName, response);
            result.HasRespondedToCfn = true;
        }
    } catch (err) {
        console.error(err);
        const response = {
            status: 'FAILED',
            data: { Error: err.message }
        };

        await sendResponse(event.Context.Execution.Input.customResourceEvent, context.logStreamName, response);
        result.HasRespondedToCfn = true;
    }

    return { result };
};

/**
 * Checks the CloudFormation StackSet operation and validates that all instances have been updated
 * @param {string} stackSetName The name of the StackSet
 * @param {string} operationId The id of the StackSet operation
 */
const areAllInstancesUpdated = async (stackSetName, operationId) => {
    let listResponse;
    const listParams = { StackSetName: stackSetName, OperationId: operationId };
    const operationSummaries = [];

    do {
        console.log(`Listing Operation Results: ${JSON.stringify(listParams)}`);
        listResponse = await cfn.listStackSetOperationResults(listParams);
        console.log(`List Operation Results Response: ${JSON.stringify(listResponse)}`);
        if (listResponse.Summaries && listResponse.Summaries.length > 0) {
            operationSummaries.push(...listResponse.Summaries);
        }

        delete listParams.NextToken;
        if (listResponse.NextToken) {
            listParams.NextToken = listResponse.NextToken;
        }
    } while (listParams.NextToken);

    // Check if any instances failed to update
    if (operationSummaries.some(stackSetInstance => (stackSetInstance.Status && stackSetInstance.Status.toUpperCase() === 'FAILED'))) {
        throw new Error('At least one instance in this StackSet failed to update');
    }

    // Check if any instance updates were canceled
    if (operationSummaries.some(stackSetInstance => (stackSetInstance.Status && stackSetInstance.Status.toUpperCase() === 'CANCELLED'))) {
        throw new Error('At least one instance update was canceled');
    }

    // Return whether all instances are successfully updated
    return (operationSummaries.length > 0 && operationSummaries.every(stackSetInstance => (stackSetInstance.Status && stackSetInstance.Status.toUpperCase() === 'SUCCEEDED')));
};

/**
 * Deletes the solution's StackSet
 * @param {string} StackSetName The name of the StackSet
 */
const deleteStackSet = async function deleteStackSet(StackSetName) {
    const params = { StackSetName };

    console.log(`Deleting StackSet: ${JSON.stringify(params)}`);
    const response = await cfn.deleteStackSet(params);
    console.log(`Delete StackSet response: ${JSON.stringify(response)}`);
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
        PhysicalResourceId: event.LogicalResourceId,
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
