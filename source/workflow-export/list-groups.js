// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
    CognitoIdentityProvider: CognitoIdentityServiceProvider
} = require("@aws-sdk/client-cognito-identity-provider");
const cognitoISP = new CognitoIdentityServiceProvider(getOptions());
const HelperFunctions = require('../utils/helper-functions');

/**
 * Lists group in a user pool and returns group details so they can be processed by the Export Workflow
 * @param {object} event Event request payload
 */
exports.handler = async (event) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const requiredEnvironmentVariables = ['USER_POOL_ID'];
    const requiredEventProperties = ['ExportTimestamp'];
    const optionalEventProperties = ['ListGroupsNextToken'];
    const functionData = HelperFunctions.getFunctionData(requiredEnvironmentVariables, requiredEventProperties, optionalEventProperties, event);

    const groups = [];
    const listGroupsParams = {
        UserPoolId: functionData.USER_POOL_ID
    };

    if (functionData.ListGroupsNextToken) {
        listGroupsParams.NextToken = functionData.ListGroupsNextToken;
    }

    console.log(`Listing groups: ${JSON.stringify(listGroupsParams)}`);
    const response = await cognitoISP.listGroups(listGroupsParams);

    if (response.Groups) {
        console.log(`Number of groups returned: ${response.Groups.length}`);
        groups.push(...response.Groups.map(group => {
            const returnGroup = {
                groupName: group.GroupName,
                groupLastModifiedDate: group.LastModifiedDate,
                UsernameAttributes: event.UsernameAttributes || '[]'
            };
            returnGroup.groupDescription = group.Description ? group.Description : '';
            returnGroup.groupPrecedence = group.Precedence !== undefined ? group.Precedence : -1;

            return returnGroup;
        }));
    } else {
        console.log('No groups were returned');
    }

    const output = { ExportTimestamp: functionData.ExportTimestamp, NumGroupsToProcess: groups.length, Groups: [...groups], ListGroupsNextToken: response.NextToken };

    // Check to see if there are more groups to fetch
    if (output.ListGroupsNextToken){
        output.ProcessedAllGroups = 'No'
    }
    else{
        output.ProcessedAllGroups = 'Yes';
    }

    console.log(`Output: ${JSON.stringify(output)}`);
    return output;
};
