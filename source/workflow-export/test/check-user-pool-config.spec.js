// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK

const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProvider, DescribeUserPoolCommand } = require("@aws-sdk/client-cognito-identity-provider");
const mockCognitoISP = mockClient(CognitoIdentityProvider);

describe('check-user-pool-config', function () {
  beforeEach(() => {
    process.env.NOTIFICATION_TOPIC = 'notification-topic';
    process.env.SOURCE_USER_POOL_ID = 'src-user-pool-id';
    process.env.BACKUP_USER_POOL_ID = 'backup-user-pool-id';
    process.env.AWS_REGION = 'us-east-1';
    process.env.BACKUP_REGION = 'us-east-2';
    mockCognitoISP.reset();
  });

  it('Should return the user pool Username attributes', async function () {
    mockCognitoISP.on(DescribeUserPoolCommand).resolvesOnce({
      UserPool: {
        MfaConfiguration: 'OFF',
        UsernameAttributes: ['email']
      }
    });

    const event = {};
    const lambda = require('../check-user-pool-config');
    const result = await lambda.handler(event);
    expect(result).toEqual({ result: { UsernameAttributes: JSON.stringify(['email']) } });
  });

  it('Should should handle user pools with no Username attributes', async function () {
    mockCognitoISP.on(DescribeUserPoolCommand).resolvesOnce({
      UserPool: {
        MfaConfiguration: 'OFF'
      }
    });

    const event = {};
    const lambda = require('../check-user-pool-config');
    const result = await lambda.handler(event);
    expect(result).toEqual({ result: {} });
  });

  it('Should return false if MFA is enabled', async function () {
    mockCognitoISP.on(DescribeUserPoolCommand).resolvesOnce({
      UserPool: {
        MfaConfiguration: 'OPTIONAL',
        UsernameAttributes: ['phone', 'email']
      }
    });

    const event = {};
    const lambda = require('../check-user-pool-config');
    await expect(async () => {
      await lambda.handler(event);
    }).rejects.toThrow('User Pools with MFA enabled are not supported. The user pool\'s MFA configuration is set to OPTIONAL');
  });

  it('Should return false if multiple username attributes are allowed', async function () {
    mockCognitoISP.on(DescribeUserPoolCommand).resolvesOnce({
      UserPool: {
        MfaConfiguration: 'OFF',
        UsernameAttributes: ['phone', 'email']
      }
    });

    const event = {};
    const lambda = require('../check-user-pool-config');
    await expect(async () => {
      await lambda.handler(event);
    }).rejects.toThrow('This solution does not support user pools for which more than one username attribute is allowed. Configured username attributes: ["phone","email"]');
  });
});
