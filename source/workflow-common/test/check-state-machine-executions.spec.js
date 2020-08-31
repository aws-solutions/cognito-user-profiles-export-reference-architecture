// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

// Mock AWS SDK
const mockStepFunctions = jest.fn();
const mockAWS = require('aws-sdk');
mockAWS.StepFunctions = jest.fn(() => ({
  listExecutions: mockStepFunctions
}));

describe('check-state-machine-executions', function () {
  beforeEach(() => { mockStepFunctions.mockReset(); });

  it('Should return true if there is only one execution running', async function () {
    mockStepFunctions.mockImplementationOnce(() => {
      return {
        promise() {
          // stepFunctions.listExecutions
          return Promise.resolve({
            executions: [{ executionArn: 'execution-id' }]
          });
        }
      };
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
    mockStepFunctions.mockImplementationOnce(() => {
      return {
        promise() {
          // stepFunctions.listExecutions
          return Promise.resolve({
            executions: []
          });
        }
      };
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
    mockStepFunctions.mockImplementationOnce(() => {
      return {
        promise() {
          // stepFunctions.listExecutions
          return Promise.resolve({
            executions: [{ executionArn: 'execution-id' }, { executionArn: 'execution-id-2' }]
          });
        }
      };
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
    mockStepFunctions.mockImplementationOnce(() => {
      return {
        promise() {
          // stepFunctions.listExecutions
          return Promise.resolve({
            executions: [{ executionArn: 'other-execution-id' }]
          });
        }
      };
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