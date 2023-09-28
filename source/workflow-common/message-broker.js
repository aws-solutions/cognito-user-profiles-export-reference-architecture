// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');

const {
          DynamoDBClient
      } = require("@aws-sdk/client-dynamodb"),
      {
          SNS
      } = require("@aws-sdk/client-sns"),
      { 
        DynamoDBDocumentClient, PutCommand
      } = require("@aws-sdk/lib-dynamodb");
const sns = new SNS(getOptions());
const dynamodbClient = new DynamoDBClient(getOptions());
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const { BACKUP_TABLE_NAME, TYPE_TIMESTAMP, SNS_MESSAGE_PREFERENCE, SEND_METRIC, METRICS_ANONYMOUS_UUID, SOLUTION_ID, SOLUTION_VERSION, AWS_REGION, IS_PRIMARY_REGION, NOTIFICATION_TOPIC } = process.env;
const { sendAnonymousMetric } = require('../utils/metrics');

/**
 * Publishes info and error messages to the solution's SNS topic and if enabled, sends anonymized operational metrics
 * @param {object} event 
 */
exports.handler = async (event) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const { Context, Input } = event;

    switch (Context.State.Name) {
        case 'WorkflowErrorHandlerLambda':
        case 'WorkflowErrorHandlerLambdaGroupsMap':
        case 'WorkflowErrorHandlerLambdaDeletedGroupsMap':
        case 'Parallel: WorkflowErrorHandlerLambda (Scan Table)':
        case 'Parallel: WorkflowErrorHandlerLambda':
            await handleError(Context, Input);
            break;
        case 'WorkflowCleanupLambda':
            await handleCleanup(Context, Input);
            break;
        default:
            console.log(`Unknown State Name: ${Context.State.Name}`);
            break;
    }
};

/**
 * Publishes a message to the solution's SNS topic to inform of the error. Sends a metric if enabled 
 * @param {*} Context State Machine context
 * @param {*} Input Lambda input
 */
const handleError = async (Context, Input) => {
    let shouldSendMetric = (SEND_METRIC === 'Yes');
    let error = 'Unknown';
    const workflowName = Context.StateMachine.Name;
    if (Input && Input.Cause) {
        try {
            error = JSON.parse(Input.Cause);
        } catch (err) {
            console.error(err);
            if (Input.Cause.trim() !== '') {
                error = Input.Cause;
            }
        }
    }

    // Publish the message to the solution's Noitification Topic
    await publishMessage(`An unexpected error occurred while executing the ${workflowName} for this solution:\n${JSON.stringify(error, null, 2)}\n\nPlease check the state machine's task logs for additional information\n\nExecution details:\n${JSON.stringify(Context, null, 2)}`);

    if (shouldSendMetric) {
        try {
            let executionTime = getExecutionTime(Context);

            await sendMetric({
                EventType: 'workflow-error',
                EventDetails: {
                    Region: AWS_REGION,
                    IsPrimaryRegion: IS_PRIMARY_REGION,
                    ExecutionTimeInSeconds: executionTime,
                    WorkflowName: workflowName.split('-')[0]
                }
            });
        } catch (err) {
            console.error(err);
        }
    }
};

/**
 * Publishes a message to the solution's Notification SNS Topic
 * @param {string} msg Message to publish
 */
const publishMessage = async (msg) => {
    console.log('Publishing message to notification topic');
    await sns.publish({ TopicArn: NOTIFICATION_TOPIC, Message: msg });
    console.log('Message published');
};

/**
 * Sends anonymized operational metric
 * @param {object} payload Metric data
 */
const sendMetric = async (payload) => {
    await sendAnonymousMetric(SOLUTION_ID, SOLUTION_VERSION, METRICS_ANONYMOUS_UUID, payload);
};

/**
 * Publishes a message to the solution's SNS topic to inform of the workflow completion. Sends a metric if enabled 
 * @param {*} Context State Machine context
 * @param {*} Input Lambda input
 */
const handleCleanup = async (Context, Input) => {
    const workflowName = Context.StateMachine.Name;
    const executionTime = getExecutionTime(Context);
    let shouldSendMetric = (SEND_METRIC === 'Yes');

    switch (workflowName.split('-')[0]) {
        case 'ExportWorkflow':
            if (Input && Input.ExportTimestamp) {
                await updateLatestExportTimestamp(Input.ExportTimestamp);
            }
            break;
        case 'ImportWorkflow':
            // Send metric if enabled
            break;
        default:
            shouldSendMetric = false;
            break;
    }

    if (SNS_MESSAGE_PREFERENCE === 'INFO_AND_ERRORS') {
        // Publish the message to the solution's Noitification Topic
        await publishMessage(`Workflow (${workflowName}) completed successfully. Execution took ${executionTime} second(s).\n\nExecution details:\n${JSON.stringify(Context, null, 2)}`);
    }

    if (shouldSendMetric) {
        try {
            await sendAnonymousMetric(SOLUTION_ID, SOLUTION_VERSION, METRICS_ANONYMOUS_UUID, {
                EventType: 'workflow-finished',
                EventDetails: {
                    Region: AWS_REGION,
                    IsPrimaryRegion: IS_PRIMARY_REGION,
                    ExecutionTimeInSeconds: executionTime,
                    WorkflowName: workflowName.split('-')[0]
                }
            });
        } catch (err) {
            console.error(err);
        }
    }
};

/**
 * Updates the Backup Table with the last time the Export Workflow was successfully completed
 * @param {number} exportTimestamp 
 */
const updateLatestExportTimestamp = async (exportTimestamp) => {
    const putParams = {
        TableName: BACKUP_TABLE_NAME,
        Item: {
            id: 'latest-export-timestamp',
            type: TYPE_TIMESTAMP,
            latestExportTimestamp: exportTimestamp
        }
    };

    console.log(`Updating latest export timestamp: ${JSON.stringify(putParams)}`);
    await docClient.send(new PutCommand(putParams));
    console.log('Latest export timestamp updated');
};

/**
 * Returns the state machine execution time in seconds
 * @param {object} Context State Machine Context
 */
const getExecutionTime = (Context) => {
    let executionTime = -1;
    const startTime = new Date(Context.Execution.StartTime).getTime();
    const endTime = new Date(Context.State.EnteredTime).getTime();
    executionTime = (endTime - startTime) / 1000;
    return executionTime;
};
