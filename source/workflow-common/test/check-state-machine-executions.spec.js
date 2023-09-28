// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK

const { mockClient } = require('aws-sdk-client-mock');
const { SFN, ListExecutionsCommand } = require("@aws-sdk/client-sfn");
const mockStepFunctions = mockClient(SFN);

describe('check-state-machine-executions', function () {
  beforeEach(() => { 
    mockStepFunctions.reset(); 
  });

  it('Should return true if there is only one execution running', async function () {
    mockStepFunctions.on(ListExecutionsCommand).resolvesOnce({
      executions: [{ executionArn: 'execution-id' }]
    });

    const event = {
      Context: {
        StateMachine: { Id: 'state-machine-id' },
        Execution: { Id: 'execution-id' }
      }
    };

    const lambda = require('../check-state-machine-executions');
    const result = await lambda.handler(event);
    expect(result).toEqual({ result: { OnlyThisStateMachineExecution: true } });
  });

  it('Should return false if there is no executions are returned', async function () {
    mockStepFunctions.on(ListExecutionsCommand).resolvesOnce({
      executions: []
    });

    const event = {
      Context: {
        StateMachine: { Id: 'state-machine-id' },
        Execution: { Id: 'execution-id' }
      }
    };

    const lambda = require('../check-state-machine-executions');
    const result = await lambda.handler(event);
    expect(result).toEqual({ result: { OnlyThisStateMachineExecution: false } });
  });

  it('Should return false if there are more than one executions returned', async function () {
    mockStepFunctions.on(ListExecutionsCommand).resolvesOnce({
      executions: [{ executionArn: 'execution-id' }, { executionArn: 'execution-id-2' }]
    });

    const event = {
      Context: {
        StateMachine: { Id: 'state-machine-id' },
        Execution: { Id: 'execution-id' }
      }
    };

    const lambda = require('../check-state-machine-executions');
    const result = await lambda.handler(event);
    expect(result).toEqual({ result: { OnlyThisStateMachineExecution: false } });
  });

  it('Should return false if the execution ID doesn\'t match the event', async function () {
    mockStepFunctions.on(ListExecutionsCommand).resolvesOnce({
      executions: [{ executionArn: 'other-execution-id' }]
    });

    const event = {
      Context: {
        StateMachine: { Id: 'state-machine-id' },
        Execution: { Id: 'execution-id' }
      }
    };

    const lambda = require('../check-state-machine-executions');
    const result = await lambda.handler(event);
    expect(result).toEqual({ result: { OnlyThisStateMachineExecution: false } });
  });
});