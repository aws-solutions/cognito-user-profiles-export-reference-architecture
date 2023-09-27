// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock context
const context = {
    logStreamName: 'log-stream'
};

// Mock AWS SDK
const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, ListGroupsCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognitoISP = mockClient(CognitoIdentityProvider);

describe('list-groups', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        mockCognitoISP.reset();
        process.env = { ...OLD_ENV };
        delete process.env.NODE_ENV;
        process.env.USER_POOL_ID = 'foo-user-pool-id';
    });

    afterEach(() => {
        process.env = OLD_ENV;
    });

    it('should return the same number of groups that Cognito returned', async function () {
        const event = { ExportTimestamp: new Date().getTime() };
        const listGroupsResponse = {
            Groups: [
                { GroupName: 'group-1' },
                { GroupName: 'group-2' },
                { GroupName: 'group-3' }
            ]
        };

        mockCognitoISP.on(ListGroupsCommand).resolves(listGroupsResponse);

        const lambda = require('../list-groups');
        const resp = await lambda.handler(event, context);

        expect(resp.ExportTimestamp).toBe(event.ExportTimestamp);
        expect(resp.NumGroupsToProcess).toBe(listGroupsResponse.Groups.length);
        expect(resp.Groups.length).toBe(listGroupsResponse.Groups.length);
        expect(resp.ProcessedAllGroups).toBe('Yes');
    });

    it('should return the NextToken when it is sent by Cognito', async function () {
        const event = { ExportTimestamp: new Date().getTime() };
        const listGroupsResponse = {
            Groups: [{ GroupName: 'group-1' }],
            NextToken: 'foo-next-token'
        };

        mockCognitoISP.on(ListGroupsCommand).resolves(listGroupsResponse);

        const lambda = require('../list-groups');
        const resp = await lambda.handler(event, context);

        expect(resp.ExportTimestamp).toBe(event.ExportTimestamp);
        expect(resp.ProcessedAllGroups).toBe('No');
        expect(resp.ListGroupsNextToken).toBe(listGroupsResponse.NextToken);
    });

    it('should return an empty GroupName array when Cognito returns no groups', async function () {
        const event = { ExportTimestamp: new Date().getTime() };
        const listGroupsResponse = {
        };

        mockCognitoISP.on(ListGroupsCommand).resolves(listGroupsResponse);

        const lambda = require('../list-groups');
        const resp = await lambda.handler(event, context);

        expect(resp.ExportTimestamp).toBe(event.ExportTimestamp);
        expect(resp.NumGroupsToProcess).toBe(0);
        expect(resp.Groups.length).toBe(0);
        expect(resp.ProcessedAllGroups).toBe('Yes');
    });

    it('should return the same number of groups that Cognito returned when a NextToken is supplied', async function () {
        const event = { ExportTimestamp: new Date().getTime(), ListGroupsNextToken: 'foo-next-token' };
        const listGroupsResponse = {
            Groups: [
                { GroupName: 'group-1' },
                { GroupName: 'group-2' }
            ]
        };

        mockCognitoISP.on(ListGroupsCommand).resolves(listGroupsResponse);

        const lambda = require('../list-groups');
        const resp = await lambda.handler(event, context);

        expect(resp.ExportTimestamp).toBe(event.ExportTimestamp);
        expect(resp.NumGroupsToProcess).toBe(listGroupsResponse.Groups.length);
        expect(resp.Groups.length).toBe(listGroupsResponse.Groups.length);
        expect(resp.ProcessedAllGroups).toBe('Yes');
    });
});
