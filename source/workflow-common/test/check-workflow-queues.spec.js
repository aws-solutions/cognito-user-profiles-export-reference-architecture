// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK

const { mockClient } = require('aws-sdk-client-mock');
const { SQS, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const mockSqs = mockClient(SQS);

beforeAll(() => {
    process.env = Object.assign(process.env, {
        NEW_USERS_QUEUE_URL: 'new-users-queue-url',
        UPDATES_QUEUE_URL: 'updates-queue-url'
    });
});

describe('check-workflow-queues', function () {
    beforeEach(() => {
        mockSqs.reset();
    });

    it('Throws an error if a queue attribute is not zero', async function () {
        mockSqs.on(GetQueueAttributesCommand).resolvesOnce({
            "Attributes": {
                "ApproximateNumberOfMessages": "0",
                "ApproximateNumberOfMessagesNotVisible": "0",
                "ApproximateNumberOfMessagesDelayed": "0"
            }
        }).resolvesOnce({
            "Attributes": {
                "ApproximateNumberOfMessages": "0",
                "ApproximateNumberOfMessagesNotVisible": "0",
                "ApproximateNumberOfMessagesDelayed": "1"
            }
        });

        const event = {
            Context: {
                Execution: { StartTime: new Date(0).toISOString() },
                StateMachine: { Id: 'id', StartTime: new Date(), Name: 'ImportWorkflow-HASHVALUE' }
            },
            Input: {
                "OnlyThisStateMachineExecution": true
            }
        };
        const lambda = require('../check-workflow-queues');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Queue (updates-queue-url) is not empty. Expected a value of "0" for attribute (ApproximateNumberOfMessagesDelayed) and found value "1" instead. Please purge this queue prior to running this workflow');
    });

    it('Throws an error for an unexpected state machine name', async function () {
        const event = {
            Context: {
                Execution: { StartTime: new Date(0).toISOString() },
                StateMachine: { Id: 'id', StartTime: new Date(), Name: 'StateMachineName' }
            },
            Input: {
                "OnlyThisStateMachineExecution": true
            }
        };
        const lambda = require('../check-workflow-queues');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unknown State Machine Name: StateMachineName');
    });

    it('Returns when all queue attributes are zero', async function () {
        mockSqs.on(GetQueueAttributesCommand).resolvesOnce({
            "Attributes": {
                "ApproximateNumberOfMessages": "0",
                "ApproximateNumberOfMessagesNotVisible": "0",
                "ApproximateNumberOfMessagesDelayed": "0"
            }
        }).resolvesOnce({
            "Attributes": {
                "ApproximateNumberOfMessages": "0",
                "ApproximateNumberOfMessagesNotVisible": "0",
                "ApproximateNumberOfMessagesDelayed": "0"
            }
        });

        const event = {
            Context: {
                Execution: { StartTime: new Date(0).toISOString() },
                StateMachine: { Id: 'id', StartTime: new Date(), Name: 'ImportWorkflow-HASHVALUE' }
            },
            Input: {
                "OnlyThisStateMachineExecution": true
            }
        };

        const lambda = require('../check-workflow-queues');
        const result = await lambda.handler(event);
        expect(result).toEqual({ result: { OnlyThisStateMachineExecution: true, QueuesStartedOutEmpty: true } });
    });
});
