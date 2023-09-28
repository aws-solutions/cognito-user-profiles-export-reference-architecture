// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
    SQS
} = require("@aws-sdk/client-sqs");
const sqs = new SQS(getOptions());
const { NEW_USERS_QUEUE_URL, UPDATES_QUEUE_URL } = process.env;

/**
 * Validates that the Queue(s) used by the workflow are empty
 * @param {object} event 
 */
exports.handler = async (event) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const { Context, Input } = event;
    const stateMachineName = Context.StateMachine.Name.split('-')[0];
    const result = Input;

    if (stateMachineName === 'ImportWorkflow') {
        const newUsersQueueEmpty = await isQueueEmpty(NEW_USERS_QUEUE_URL);
        const updatesQueueEmpty = await isQueueEmpty(UPDATES_QUEUE_URL);
        result.QueuesStartedOutEmpty = (newUsersQueueEmpty && updatesQueueEmpty);
    } else {
        throw new Error(`Unknown State Machine Name: ${stateMachineName}`);
    }

    console.log(`Result: ${JSON.stringify(result)}`);
    return { result };
};

/**
 * Returns true if the SQS Queue with the supplied URL is empty. Throws an Error otherwise
 * @param {string} queueUrl The URL of the SQS Queue to evaluate
 */
const isQueueEmpty = async (queueUrl) => {
    const attributesToCheck = ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesVisible', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'];
    const params = { QueueUrl: queueUrl, AttributeNames: ['All'] };

    console.log(`Getting queue attributes: ${JSON.stringify(params)}`);
    const response = await sqs.getQueueAttributes(params);
    console.log('Get queue attributes response', JSON.stringify(response, null, 2));

    for (let attribute of attributesToCheck) {
        if (response.Attributes && response.Attributes.hasOwnProperty(attribute)) {
            console.log(`Checking attribute (${attribute})`);
            if (response.Attributes[attribute] !== '0') {
                throw new Error(`Queue (${queueUrl}) is not empty. Expected a value of "0" for attribute (${attribute}) and found value "${response.Attributes[attribute]}" instead. Please purge this queue prior to running this workflow`);
            }
        }
    }

    return true;
};
