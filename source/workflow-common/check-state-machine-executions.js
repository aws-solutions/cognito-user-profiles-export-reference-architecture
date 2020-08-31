// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const AWS = require('aws-sdk');
const stepFunctions = new AWS.StepFunctions();

/**
 * Returns whether a state machine has multiple executions running
 * @param {object} event 
 */
exports.handler = async (event) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const stateMachineArn = event.Context.StateMachine.Id;
    const stateMachineExecutionId = event.Context.Execution.Id;
    const result = {};

    const listExecutionsParams = {
        stateMachineArn: stateMachineArn,
        statusFilter: 'RUNNING'
    };

    console.log(`Listing state machine executions: ${JSON.stringify(listExecutionsParams)}`);
    const response = await stepFunctions.listExecutions(listExecutionsParams).promise();
    console.log(JSON.stringify(response));

    result.OnlyThisStateMachineExecution = (response.executions.length === 1 && response.executions[0].executionArn === stateMachineExecutionId);
    console.log(`Result: ${JSON.stringify(result)}`);
    return { result: result };
};
