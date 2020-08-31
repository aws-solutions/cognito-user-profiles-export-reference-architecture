// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const CustomResourceHelperFunctions = require('../utils/custom-resource-helper-functions');
const { appendToStrWithMaxChar } = require('../utils/helper-functions');
const uuid = require('uuid');

/**
 * Generates values to be used within the solution
 */
exports.handler = async (event, context) => {
    return await CustomResourceHelperFunctions.handler(event, context, handleCreate);
};

/**
 * Generates values to be used within the solution
 * @param {object} event The incoming event from the Custom Resource invokation
 */
const handleCreate = async function handleCreate(event) {
    const { StackName } = event.ResourceProperties;
    const solutionInstanceUUID = uuid.v4();
    const formattedStackName = StackName.length < 15 ? StackName : StackName.slice(0, 15);
    return {
        StackSetName: getStackSetName(StackName),
        FormattedStackName: formattedStackName,
        UserImportJobMappingFileBucketPrefix: `${formattedStackName.toLowerCase()}-import-jobs-${solutionInstanceUUID.split('-').pop()}`,
        SolutionInstanceUUID: solutionInstanceUUID,
        AnonymousDataUUID: uuid.v4()
    };
};

/**
 * Generates a name to be used for the solution's StackSet, making sure to stay within the StackSet name character limit
 * @param {string} stackName The name of the CloudFormation Stack
 */
const getStackSetName = function getStackSetNameFromStackName(stackName) {
    const stackSetNameMaxChars = 128;
    const suffix = '-StackSet';

    return appendToStrWithMaxChar(stackName, suffix, stackSetNameMaxChars);
};
