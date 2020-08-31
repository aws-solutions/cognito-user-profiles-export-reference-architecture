// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK
const mockCognito = jest.fn();
const mockDynamoDB = jest.fn();
jest.mock('aws-sdk', () => {
  return {
    CognitoIdentityServiceProvider: jest.fn(() => ({
      listUsers: mockCognito
    }))
  };
});
jest.mock('aws-sdk/clients/dynamodb', () => {
  return {
    DocumentClient: jest.fn(() => ({
      batchWrite: mockDynamoDB
    }))
  };
});

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
    mockCognito.mockReset();
    mockDynamoDB.mockReset();
  });

  describe('step function first try', function () {
    const event = {};
    const context = {
      getRemainingTimeInMillis: function () {
        return 100000;
      }
    };

    it('should return empty paginationToken - cognito: no user', async () => {
      mockCognito.mockImplementation(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve({ Users: [] });
          }
        };
      });

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
      mockCognito.mockImplementationOnce(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve(JSON.parse(JSON.stringify(mockUsers)));
          }
        };
      });
      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.resolve({ UnprocessedItems: {} });
          }
        };
      });

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
      mockCognito.mockImplementation(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve(JSON.parse(JSON.stringify(mockUsers)));
          }
        };
      });
      mockDynamoDB
        .mockImplementationOnce(() => {
          return {
            promise() {
              // dynamodb.batchWrite
              const unprocessedItems = {};
              unprocessedItems[process.env.TABLE_NAME] = [{ PutRequest: {} }];

              return Promise.resolve({ UnprocessedItems: unprocessedItems });
            }
          };
        })
        .mockImplementationOnce(() => {
          return {
            promise() {
              // dynamodb.batchWrite
              const unprocessedItems = {};
              unprocessedItems[process.env.TABLE_NAME] = [{ PutRequest: {} }];

              return Promise.resolve({ UnprocessedItems: { [process.env.TABLE_NAME]: [] } });
            }
          };
        });


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
      mockCognito.mockImplementationOnce(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve({
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
          }
        };
      });

      mockCognito.mockImplementationOnce(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve({
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
          }
        };
      });

      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.resolve({ UnprocessedItems: {} });
          }
        };
      });

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

      mockCognito.mockImplementation(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve(JSON.parse(JSON.stringify(mockUsersWithToken)));
          }
        };
      });
      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.resolve({ UnprocessedItems: {} });
          }
        };
      });

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
      mockCognito.mockImplementationOnce(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve(JSON.parse(JSON.stringify(mockUsers)));
          }
        };
      });
      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.resolve({ UnprocessedItems: {} });
          }
        };
      });

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
      mockCognito.mockImplementationOnce(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve({
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
          }
        };
      });

      mockCognito.mockImplementationOnce(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve({
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
          }
        };
      });

      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.resolve({ UnprocessedItems: {} });
          }
        };
      });

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

      mockCognito.mockImplementation(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve(JSON.parse(JSON.stringify(mockUsersWithToken)));
          }
        };
      });
      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.resolve({ UnprocessedItems: {} });
          }
        };
      });

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
    const event = {};
    const context = {
      getRemainingTimeInMillis: function () {
        return 100000;
      }
    };

    it('should throw an error - cognito-idp:listUsers failure', async () => {
      mockCognito.mockImplementation(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.reject({
              message: 'ERROR - listUsers'
            });
          }
        };
      });

      const lambda = require('../export-users');
      try {
        await lambda.handler(event, context);
      } catch (error) {
        expect(error).toEqual({
          message: 'ERROR - listUsers'
        });
      }
    });

    it('should throw an error - dynamodb:batchWrite failure', async () => {
      mockCognito.mockImplementation(() => {
        return {
          promise() {
            // cognitoIdentityServiceProvider.listUsers
            return Promise.resolve(JSON.parse(JSON.stringify(mockUsers)));
          }
        };
      });
      mockDynamoDB.mockImplementation(() => {
        return {
          promise() {
            // dynamodb.batchWrite
            return Promise.reject({
              message: 'ERROR - batchWrite'
            });
          }
        };
      });

      const lambda = require('../export-users');
      try {
        await lambda.handler(event, context);
      } catch (error) {
        expect(error).toEqual({
          message: 'ERROR - batchWrite'
        });
      }
    });
  });
});