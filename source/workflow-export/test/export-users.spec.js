// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK

const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, ListUsersCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognito = mockClient(CognitoIdentityProvider);

const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");
const mockDynamoDB = mockClient(DynamoDBDocumentClient);

// Mock Date
const now = new Date();
global.Date = jest.fn(() => now);
global.Date.getTime = now.getTime();

const mockUser = {
  Username: 'mock-user',
  Attributes: [
    {
      Name: 'sub',
      Value: 'bd830ed0-bc56-448e-9bd9-d6e597bcd20f'
    }
  ],
  UserCreateDate: 1591893018.766,
  UserLastModifiedDate: 1592238002.126,
  Enabled: true,
  UserStatus: 'CONFIRMED'
};
const mockUsers = {
  Users: [mockUser]
};
const mockUsersWithToken = {
  Users: [mockUser],
  PaginationToken: 'nextToken'
};
const mockDate = new Date().getTime();

beforeAll(() => {
  process.env = Object.assign(process.env, {
    AWS_REGION: 'us-east-1',
    USER_POOL_ID: 'user-pool-id',
    TABLE_NAME: 'table-name',
    COGNITO_TPS: '10'
  });
});

describe('export-users', function () {
  beforeEach(() => {
    mockCognito.reset();
    mockDynamoDB.reset();
  });

  describe('step function first try', function () {
    const event = {};
    const context = {
      getRemainingTimeInMillis: function () {
        return 100000;
      }
    };

    it('should return empty paginationToken - cognito: no user', async () => {
      mockCognito.on(ListUsersCommand).resolves({ Users: [] });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: '',
          ExportTimestamp: now.getTime()
        },
        totalUserProcessedCount: 0
      });
    });

    it('should return empty paginationToken - cognito: no more user', async () => {
      mockCognito.on(ListUsersCommand).resolvesOnce(JSON.parse(JSON.stringify(mockUsers)));
      mockDynamoDB.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: '',
          ExportTimestamp: now.getTime()
        },
        totalUserProcessedCount: 1
      });
    });

    it('should return empty paginationToken - cognito: no more user, dynamodb: unprocessed items', async () => {
      mockCognito.on(ListUsersCommand).resolves(JSON.parse(JSON.stringify(mockUsers)));
      mockDynamoDB.on(BatchWriteCommand).resolvesOnce({ UnprocessedItems: {[process.env.TABLE_NAME] : [{ PutRequest: {} }]} })
        .resolvesOnce({ UnprocessedItems: { [process.env.TABLE_NAME]: [] } });


      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: '',
          ExportTimestamp: now.getTime()
        },
        totalUserProcessedCount: 1
      });
    });

    it('should return empty paginationToken - cognito: more users', async () => {
      mockCognito.on(ListUsersCommand).resolvesOnce({
        Users: [{
          Username: 'mock-user',
          Attributes: [
            {
              Name: 'sub',
              Value: 'bd830ed0-bc56-448e-9bd9-d6e597bcd20f'
            }
          ],
          UserCreateDate: 1591893018.766,
          UserLastModifiedDate: 1592238002.126,
          Enabled: true,
          UserStatus: 'CONFIRMED'
        }],
        PaginationToken: 'nextToken'
      }).resolvesOnce({
        Users: [{
          Username: 'mock-user',
          Attributes: [
            {
              Name: 'sub',
              Value: 'bd830ed0-bc56-448e-9bd9-d6e597bcd20f'
            }
          ],
          UserCreateDate: 1591893018.766,
          UserLastModifiedDate: 1592238002.126,
          Enabled: true,
          UserStatus: 'CONFIRMED'
        }]
      });

      mockDynamoDB.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: '',
          ExportTimestamp: now.getTime()
        },
        totalUserProcessedCount: 2
      });
    });

    it('should return paginationToken - cognito: more users, timeout', async () => {
      context.getRemainingTimeInMillis = function () {
        return 1000;
      };

      mockCognito.on(ListUsersCommand).resolves(JSON.parse(JSON.stringify(mockUsersWithToken)));
      mockDynamoDB.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: mockUsersWithToken.PaginationToken,
          ExportTimestamp: now.getTime()
        },
        totalUserProcessedCount: 1
      });
    });
  });

  describe('step function iteration', function () {
    const event = {
      paginationToken: mockUsersWithToken.PaginationToken,
      ExportTimestamp: mockDate
    };
    const context = {
      getRemainingTimeInMillis: function () {
        return 100000;
      }
    };

    it('should return empty paginationToken - cognito: no more user', async () => {
      mockCognito.on(ListUsersCommand).resolvesOnce(JSON.parse(JSON.stringify(mockUsers)));
      mockDynamoDB.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: '',
          ExportTimestamp: mockDate
        },
        totalUserProcessedCount: 1
      });
    });

    it('should return empty paginationToken - cognito: more users', async () => {
      mockCognito.on(ListUsersCommand).resolvesOnce({
        Users: [{
          Username: 'mock-user',
          Attributes: [
            {
              Name: 'sub',
              Value: 'bd830ed0-bc56-448e-9bd9-d6e597bcd20f'
            }
          ],
          UserCreateDate: 1591893018.766,
          UserLastModifiedDate: 1592238002.126,
          Enabled: true,
          UserStatus: 'CONFIRMED'
        }],
        PaginationToken: 'nextToken'
      }).resolvesOnce({
        Users: [{
          Username: 'mock-user',
          Attributes: [
            {
              Name: 'sub',
              Value: 'bd830ed0-bc56-448e-9bd9-d6e597bcd20f'
            }
          ],
          UserCreateDate: 1591893018.766,
          UserLastModifiedDate: 1592238002.126,
          Enabled: true,
          UserStatus: 'CONFIRMED'
        }]
      });

      mockDynamoDB.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: '',
          ExportTimestamp: mockDate
        },
        totalUserProcessedCount: 2
      });
    });

    it('should return paginationToken - cognito: more users, timeout', async () => {
      context.getRemainingTimeInMillis = function () {
        return 1000;
      };

      mockCognito.on(ListUsersCommand).resolves(JSON.parse(JSON.stringify(mockUsersWithToken)));
      mockDynamoDB.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      const lambda = require('../export-users');
      const result = await lambda.handler(event, context);
      expect(result).toEqual({
        result: {
          paginationToken: mockUsersWithToken.PaginationToken,
          ExportTimestamp: mockDate
        },
        totalUserProcessedCount: 1
      });
    });
  });

  describe('error', function () {
    

    it('should throw an error - cognito-idp:listUsers failure', async () => {
      mockCognito.on(ListUsersCommand).rejects({
          message: 'ERROR - listUsers'
        });
      

      const event = { 
        paginationToken: 'string',
        ExportTimestamp: 123456, 
      };
      const context = {
        getRemainingTimeInMillis: function () {
          return 100000;
        }
      };
      const lambda = require('../export-users');
      await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('ERROR - listUsers');
    });


    it('should throw an error - dynamodb:batchWrite failure', async () => {
      mockCognito.on(ListUsersCommand).resolves(JSON.parse(JSON.stringify(mockUsers)));
      mockDynamoDB.on(BatchWriteCommand).rejects({
        message: 'ERROR - batchWrite'
      });

      const event = { 
        paginationToken: 'string',
        ExportTimestamp: 123456, 
      };
      const context = {
        getRemainingTimeInMillis: function () {
          return 100000;
        }
      };

      const lambda = require('../export-users');
      await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('ERROR - batchWrite');
    });

    it('should throw an error - event does not include valid UsernameAttributes', async () => {
    
      mockCognito.on(ListUsersCommand).resolvesOnce({
        Users: [{
          Username: 'mock-user',
          Attributes: [
            {
              Name: 'sub',
              Value: 'bd830ed0-bc56-448e-9bd9-d6e597bcd20f'
            }
          ],
          UserCreateDate: 1591893018.766,
          UserLastModifiedDate: 1592238002.126,
          Enabled: true,
          UserStatus: 'CONFIRMED'
        }],
        PaginationToken: 'nextToken'
      });
      const event = { 
        UsernameAttributes: '{"string":true, "string":42}',
        paginationToken: 'string',
        ExportTimestamp: 123456, 
      };
      const context = {
        getRemainingTimeInMillis: function () {
          return 100000;
        }
      };
      const lambda = require('../export-users');
      await expect(async () => {
            await lambda.handler(event, context);
        }).rejects.toThrow('poolUsernameAttributes.includes is not a function');
    });

  });


describe('import-new-users: Errors', function () {
    beforeEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: 'invalid' });
    });

    afterEach(() => {
        jest.resetModules();
        process.env = Object.assign(process.env, { COGNITO_TPS: '10' });
    });

    it('Throws an error if an invalid CognitoTPS value is set', async function () {
        const event = {
            Context: {
                Execution: { Input: { NewUserPoolId: 'user-pool-id' } },
                State: { Name: 'UpdateNewUsers' }
            },
            Input: { LastEvaluatedKey: 'last-key' }
        };
        const lambda = require('../export-users');
        await expect(async () => {
            await lambda.handler(event);
        }).rejects.toThrow('Unable to parse a number from the COGNITO_TPS value (invalid)');
    });

});
});