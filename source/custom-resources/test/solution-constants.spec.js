// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

const CustomResourceHelperFunctions = require('../../utils/custom-resource-helper-functions');
jest.mock('../../utils/custom-resource-helper-functions');

describe('solution-constants', function () {
    beforeEach(() => {});

    it('Handles Create With Short Stack Name', async function () {
        // Mock event data
        const event = {
            RequestType: 'Create',
            StackId: 'CFN_STACK_ID',
            RequestId: '02f6b8db-835e-4a83-b338-520f642e8f97',
            LogicalResourceId: 'SolutionConstants',
            ResponseURL: '/cfn-response',
            ResourceProperties:{
                StackName: 'stack-name'
            }
        };

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            return await handleCreate(evt);
        });

        const lambda = require('../solution-constants');
        const result = await lambda.handler(event, context);

        const uuidRegex = /([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}){1}/;
        expect(result.StackSetName).toBe(`${event.ResourceProperties.StackName}-StackSet`);
        expect(result.FormattedStackName).toBe(event.ResourceProperties.StackName);
        expect(result.UserImportJobMappingFileBucketPrefix).toBe(`stack-name-import-jobs-${result.SolutionInstanceUUID.split('-').pop()}`);
        expect(result.AnonymousDataUUID).toMatch(uuidRegex);
        expect(result.SolutionInstanceUUID).toMatch(uuidRegex);
    });

    it('Handles Create With long Stack Name', async function () {
        // Mock event data
        const event = {
            RequestType: 'Create',
            StackId: 'CFN_STACK_ID',
            RequestId: '02f6b8db-835e-4a83-b338-520f642e8f97',
            LogicalResourceId: 'SolutionConstants',
            ResponseURL: '/cfn-response',
            ResourceProperties:{
                StackName: 'this-is-a-very-long-stack-name-the-reason-it-is-this-long-is-because-we-need-it-to-be-above-one-hundred-twenty-eight-characters-which-is-pretty-long-when-you-think-about-it'
            }
        };

        CustomResourceHelperFunctions.handler.mockImplementationOnce(async (evt, ctx, handleCreate) => {
            return await handleCreate(evt);
        });

        const lambda = require('../solution-constants');
        const result = await lambda.handler(event, context);

        const uuidRegex = /([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}){1}/;
        expect(result.StackSetName).toBe('this-is-a-very-long-stack-name-the-reason-it-is-this-long-is-because-we-need-it-to-be-above-one-hundred-twenty-eight-ch-StackSet');
        expect(result.FormattedStackName).toBe('this-is-a-very-');
        expect(result.UserImportJobMappingFileBucketPrefix).toBe(`this-is-a-very--import-jobs-${result.SolutionInstanceUUID.split('-').pop()}`);
        expect(result.AnonymousDataUUID).toMatch(uuidRegex);
        expect(result.SolutionInstanceUUID).toMatch(uuidRegex);
    });
});