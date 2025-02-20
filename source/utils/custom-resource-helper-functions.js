// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
const axios = require('axios');

/**
 * Generic handler for CloudFormation Custom Resource events
 * @param {object} event Lambda event payload
 * @param {object} context Lambda context object
 * @param {function} handleCreate Handler for Create events on this Custom Resource
 * @param {function} handleUpdate Handler for Update events on this Custom Resource
 * @param {function} handleDelete Handler for Delete events on this Custom Resource
 */
exports.handler = async (event, context, handleCreate = null, handleUpdate = null, handleDelete = null) => {
    console.log(`Received event: ${JSON.stringify(event)}`);

    let handler;
    let response = {
        status: 'SUCCESS',
        data: {}
    };

    try {
        switch (event.RequestType) {
            case 'Create':
                handler = handleCreate;
                break;
            case 'Delete':
                handler = handleDelete;
                break;
            case 'Update':
                handler = handleUpdate;
                break;
            default:
                break;
        }

        if (handler) {
            const handlerResult = await handler(event);
            if (handlerResult && typeof handlerResult === 'string') {
                response.data.Message = handlerResult;
            } else if (handlerResult && typeof handlerResult === 'object') {
                response.data = handlerResult;
            }
        } else {
            response.data.Message = `No action required for ${event.RequestType}`;
        }
    } catch (error) {
        console.error(error);
        response = {
            status: 'FAILED',
            data: { Error: error.message }
        };
    } finally {
        await this.sendResponse(event, context.logStreamName, response);
    }

    return response;
};

/**
 * Sends a response back to CloudFormation
 * @param {object} event - Custom resource event
 * @param {string} logStreamName - Custom resource log stream name
 * @param {object} response - Response object { status: "SUCCESS|FAILED", data: object }
 */
exports.sendResponse = async function sendResponseToCfn(event, logStreamName, response) {
    const responseBody = JSON.stringify({
        Status: response.status,
        Reason: `See the details in CloudWatch Log Stream: ${logStreamName}`,
        PhysicalResourceId: event.LogicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: response.data,
    });

    const config = {
        headers: {
            'Content-Type': '',
            'Content-Length': responseBody.length
        }
    };

    return await axios.put(event.ResponseURL, responseBody, config);
};
