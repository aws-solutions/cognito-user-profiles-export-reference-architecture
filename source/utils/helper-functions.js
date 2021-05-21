// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

/**
 * Validates the supplied environment variables and lambda event payload contain the expected parameters and returns an object with them
 * @param {string[]} requiredEnvironmentVariables Required lambda environment variables
 * @param {string[]} requiredEventProperties Properties required to be in the lambda event payload
 * @param {string} optionalEventProperties An array of optional event properties. If any of these properties is not present in the event payload, no Error is thrown
 * @param {object} event The lambda event payload to validate
 */
exports.getFunctionData = function validateEventAndEnvironmentVariablesAndReturnFunctionData(requiredEnvironmentVariables, requiredEventProperties, optionalEventProperties, event) {
    const output = {};

    if (this.objHasProperties(process.env, requiredEnvironmentVariables, 'Environment Variables')) {
        requiredEnvironmentVariables.forEach(envVar => {
            output[envVar] = process.env[envVar];
        });
    }

    if (this.objHasProperties(event, requiredEventProperties, 'Event Payload')) {
        requiredEventProperties.forEach(eventProp => {
            output[eventProp] = event[eventProp];
        });
    }

    if (optionalEventProperties) {
        optionalEventProperties.forEach(optionalEventProp => {
            if (event[optionalEventProp]) {
                output[optionalEventProp] = event[optionalEventProp];
            }
        });
    }

    return output;
};

/**
 * Returns true if the supplied object has all required properties. Throws Error otherwise
 * @param {object} objToValidate The object to validate
 * @param {string[]} requiredProperties The array of property names that should be present in the object to validate
 * @param {string} objectDescriptor A descriptor for the object being validated. Used in case an Error is thrown
 */
exports.objHasProperties = function objHasProperties(objToValidate, requiredProperties, objectDescriptor) {
    if (!Array.isArray(requiredProperties)) {
        throw new Error(`Error validating ${objectDescriptor}. Must pass an array as requiredProperties`);
    }

    requiredProperties.forEach(prop => {
        if (typeof prop !== 'string' || prop.trim() === '') {
            throw new Error(`Error validating ${objectDescriptor}. Must only pass non-empty strings in the requiredProperties array`);
        }

        if (!objToValidate[prop]) {
            throw new Error(`Error validating ${objectDescriptor}. Missing value for ${prop}`);
        }

        if (typeof objToValidate[prop] === 'string' && objToValidate[prop].trim() === '') {
            throw new Error(`Error validating ${objectDescriptor}. Value for ${prop} must not be only whitespace`);
        }
    });

    return true;
};

/**
 * Appends a suffix string to the supplied prefix string. The prefix string will be trimmed if the combined string's length is above maxChars
 * @param {string} prefix The prefix string
 * @param {string} suffix The string to be appended to the prefix
 * @param {number} maxChars The maximum number of characters the combined string should be
 */
exports.appendToStrWithMaxChar = function appendSuffixToPrefixAndTrimPrefixIfNeeded(prefix, suffix, maxChars) {
    let output = `${prefix ? prefix : ''}${suffix ? suffix : ''}`;

    if (maxChars > 0 && output.length > maxChars) {
        output = `${prefix.slice(0, (maxChars - suffix.length))}${suffix}`;
    }

    return output;
};

/**
 * Returns a promise to be used as a sleep function. The values for sleepTimeInSeconds will be added to the value for sleepTimeInMS
 * @param {number} sleepTimeInSeconds Number of seconds to sleep
 * @param {number} sleepTimeInMS Number of milliseconds
 * @return {Promise} Sleep promise
 */
exports.sleep = async (sleepTimeInSeconds = 0, sleepTimeInMS = 0) => {
    return new Promise(resolve => setTimeout(resolve, sleepTimeInMS + (sleepTimeInSeconds * 1000)));
};

/**
 * Returns the number of milliseconds to be used in an exponential backoff
 * @param {number} base The base number of milliseconds to wait
 * @param {number} attempt The number of times the operation has been attempted
 * @param {number} max The maximum amount of milliseconds to wait
 * @param {boolean} withJitter Set to true to add jitter (randomness) to the exponential backoff time that is returned
 * @returns {number} The number of milliseconds to be used in an exponential backoff
 */
exports.getExponentialBackoffTimeInMS = (base, attempt, max, withJitter = false) => {
    const backOffTime = Math.min(max, base * 2 ** attempt);

    if (!withJitter) {
        return backOffTime;
    }

    return 1 + Math.floor(Math.random() * backOffTime); //NOSONAR
};
