// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */
const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, ListUsersInGroupCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognitoISP = mockClient(CognitoIdentityProvider);

const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");
const mockDocClient = mockClient(DynamoDBDocumentClient);

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

beforeAll(() => {
    process.env = Object.assign(process.env, {
        AWS_REGION: 'us-east-1',
        COGNITO_TPS: '10',
        BACKUP_TABLE_NAME: 'table-name'
    });
});

describe('export-users-in-group', () => {
    beforeEach(() => {
        mockCognitoISP.reset();
        mockDocClient.reset();
    });

    it('Should return when no users are returned', async function () {
        mockCognitoISP.on(ListUsersInGroupCommand).resolvesOnce({});

        const event = {
            groupName: 'group-name',
            listUsersInGroupNextToken: 'next-token',
            exportTimestamp: new Date().getTime()
        };

        const lambda = require('../export-users-in-group');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            exportTimestamp: event.exportTimestamp,
            groupName: 'group-name',
            processedAllUsersInGroup: 'Yes'
        });
    });

    it('Should return when only external provider users are returned', async function () {
        mockCognitoISP.on(ListUsersInGroupCommand)
        .rejectsOnce({
            retryable: true,
            message: 'retryable message'
        })
        .resolvesOnce({
            Users: [{
                Username: 'name',
                UserStatus: 'EXTERNAL_PROVIDER',
                Attributes:[{
                    Name: 'sub',
                    Value: 'uuid'
                }]
            }]
        });

        const event = {
            groupName: 'group-name',
            listUsersInGroupNextToken: 'next-token',
            exportTimestamp: new Date().getTime()
        };

        const lambda = require('../export-users-in-group');
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            exportTimestamp: event.exportTimestamp,
            groupName: 'group-name',
            processedAllUsersInGroup: 'Yes'
        });
    });

    it('Should return when one user is processed', async function () {
        const event = {
            groupName: 'group-name',
            exportTimestamp: new Date().getTime()
        };

        mockCognitoISP.on(ListUsersInGroupCommand).resolvesOnce({
            Users: [{
                Username: 'user-name',
                Attributes:[{
                    Name: 'sub',
                    Value: 'uuid'
                }],
                Enabled: true,
                UserStatus: 'CONFIRMED'
            }],
            NextToken: 'next-token'
        });

        mockDocClient.on(BatchWriteCommand).resolves({UnprocessedItems:{
            'backup-table': []
        }});

        const lambda = require('../export-users-in-group');
        context.getRemainingTimeInMillis = function(){return 1000;};
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            exportTimestamp: event.exportTimestamp,
            groupName: 'group-name',
            processedAllUsersInGroup: 'No',
            listUsersInGroupNextToken: 'next-token'
        });
    });


});

describe('import-new-users: Reseting', function(){


    beforeEach(() => {
        jest.resetModules();        
        process.env = Object.assign(process.env, { COGNITO_TPS: '0' });
    });

    it('Waits when cognitoApiCallCount >= cognitoTPS', async function () {
        const { CognitoIdentityProvider, ListUsersInGroupCommand } = require("@aws-sdk/client-cognito-identity-provider");
        const mockCognitoISP2 = mockClient(CognitoIdentityProvider);

        const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");
        const mockDocClient2 = mockClient(DynamoDBDocumentClient);

        const event = {
            groupName: 'group-name',
            exportTimestamp: new Date().getTime()
        };

        mockCognitoISP2.on(ListUsersInGroupCommand).resolvesOnce({
            Users: [{
                Username: 'user-name',
                Attributes:[{
                    Name: 'sub',
                    Value: 'uuid'
                }],
                Enabled: true,
                UserStatus: 'CONFIRMED'
            }],
            NextToken: 'next-token'
        });

        mockDocClient2.on(BatchWriteCommand).resolves({UnprocessedItems:{
            'backup-table': []
        }});

        const lambda = require('../export-users-in-group');
        context.getRemainingTimeInMillis = function(){return 1000;};
        const resp = await lambda.handler(event, context);

        expect(resp).toEqual({
            exportTimestamp: event.exportTimestamp,
            groupName: 'group-name',
            processedAllUsersInGroup: 'No',
            listUsersInGroupNextToken: 'next-token'
        });
    });
});





describe('groups-invalid UsernameAttributes', function () {

    it('should throw an error - event does not include valid UsernameAttributes', async () => {
    

        mockCognitoISP.on(ListUsersInGroupCommand).resolvesOnce({
            Users: [{
                Username: 'user-name',
                Attributes:[{
                    Name: 'sub',
                    Value: 'uuid'
                }],
                Enabled: true,
                UserStatus: 'CONFIRMED'
            }],
            NextToken: 'next-token'
        });

        mockDocClient.on(BatchWriteCommand).resolves({UnprocessedItems:{
            'backup-table': []
        }});

      const event = { 
        UsernameAttributes: '{"string":true, "string":42}',
        paginationToken: 'string',
        groupName: 'group-name',
        exportTimestamp: new Date().getTime()
      };
      const context = {
        getRemainingTimeInMillis: function () {
          return 100000;
        }
      };
      const lambda = require('../export-users-in-group');
      await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('Cannot read properties of undefined (reading \'Users\')');
    });
})

describe('groups-invalid CognitoTPS', function () {
    beforeEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: 'invalid' });
    });

    it('Throws an error if an invalid CognitoTPS value is set', async function () {
        const event = { LastEvaluatedKey: 'last-key' };
        const lambda = require('../export-users-in-group');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to parse a number from the COGNITO_TPS value (invalid)');
    });


});
