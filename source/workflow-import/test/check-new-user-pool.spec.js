// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, ListUsersCommand, ListGroupsCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognito = mockClient(CognitoIdentityProvider);

describe('check-new-user-pool', function () {
    beforeEach(() => {
        process.env.NEW_USER_POOL_ID = 'user-pool-id_abcd123';
        mockCognito.reset();
    });

    it('Returns NewUserPoolEmpty=false if the new user pool has users in it', async function () {

        mockCognito.on(ListUsersCommand).resolvesOnce({
                Users: [{
                    id: 'user-id',
                    username: 'username'
                }]});

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id_abcd123' } }
            }
        };
        const lambda = require('../check-new-user-pool');
        const result = await lambda.handler(event);
        expect(result).toEqual({ result: { NewUserPoolEmpty: false } })
    });

    it('Throws an error if the user pool id is not supplied', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: '' } }
            }
        };

        const lambda = require('../check-new-user-pool');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to determine the new user pool ID');
    });

    it('Returns NewUserPoolEmpty=false if the new user pool has groups in it', async function () {
        mockCognito.on(ListUsersCommand).resolvesOnce({
            Users: []
        });

        mockCognito.on(ListGroupsCommand).resolvesOnce({
            Groups: [{
                groupName: 'name',
                groupDescription: 'desc'
            }]
        });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            }
        };
        const lambda = require('../check-new-user-pool');
        const result = await lambda.handler(event);
        expect(result).toEqual({ result: { NewUserPoolEmpty: false } })
    });

    it('Returns NewUserPoolEmpty=true if the new user pool has no users or groups in it', async function () {
        mockCognito.on(ListUsersCommand).resolvesOnce({
            Users: []
        });

        mockCognito.on(ListGroupsCommand).resolvesOnce({
            Groups: []
        });

        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } }
            }
        };
        const lambda = require('../check-new-user-pool');
        const result = await lambda.handler(event);
        expect(result).toEqual({ result: { NewUserPoolEmpty: true } })
    });
});