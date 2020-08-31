// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const mockCognitoISP = {
    listUsersInGroup: jest.fn()
};

const mockDocClient = {
    batchWrite: jest.fn()
};

// Mock context
const context = {
    logStreamName: 'log-stream',
    getRemainingTimeInMillis: function () {
        return 100000;
    }
};

jest.mock('aws-sdk', () => {
    return {
        CognitoIdentityServiceProvider: jest.fn(() => ({
            listUsersInGroup: mockCognitoISP.listUsersInGroup
        })),
        DynamoDB: {
            DocumentClient: jest.fn(() => ({
                batchWrite: mockDocClient.batchWrite
            }))
        }
    };
});

beforeAll(() => {
    process.env = Object.assign(process.env, {
        AWS_REGION: 'us-east-1',
        COGNITO_TPS: '10',
        BACKUP_TABLE_NAME: 'table-name'
    });
});

describe('export-users-in-group', () => {
    beforeEach(() => {
        for (const mockFn in mockCognitoISP) {
            mockCognitoISP[mockFn].mockReset();
        }

        for (const mockFn in mockDocClient) {
            mockDocClient[mockFn].mockReset();
        }
    });

    it('Should return when no users are returned', async function () {
        mockCognitoISP.listUsersInGroup.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
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

    it('Should return when only external provider users are returned', async function () {
        mockCognitoISP.listUsersInGroup
        .mockImplementationOnce(()=>{
            return {
                promise() {
                    return Promise.reject({
                        retryable: true,
                        message: 'retryable message'
                    });
                }
            };
        })
        .mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
                        Users: [{
                            Username: 'name',
                            UserStatus: 'EXTERNAL_PROVIDER',
                            Attributes:[{
                                Name: 'sub',
                                Value: 'uuid'
                            }]
                        }]
                    });
                }
            };
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

        mockCognitoISP.listUsersInGroup.mockImplementationOnce(() => {
            return {
                promise() {
                    return Promise.resolve({
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
                }
            };
        });

        mockDocClient.batchWrite.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({UnprocessedItems:{
                        'backup-table': []
                    }});
                }
            };
        });

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
