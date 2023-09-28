// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @author Solution Builders
 */

const { getOptions } = require('../utils/metrics');
const {
          CognitoIdentityProvider: CognitoIdentityServiceProvider
      } = require("@aws-sdk/client-cognito-identity-provider"),
      {
          S3
      } = require("@aws-sdk/client-s3"),
      {
          SQS
      } = require("@aws-sdk/client-sqs");
const cognitoISP = new CognitoIdentityServiceProvider(getOptions());
const sqs = new SQS(getOptions());
const s3 = new S3(getOptions());
const {
    NEW_USERS_QUEUE_URL, USER_IMPORT_CLOUDWATCH_ROLE_ARN,
    USER_IMPORT_JOB_MAPPING_FILES_BUCKET, SEND_METRIC, METRICS_ANONYMOUS_UUID,
    SOLUTION_ID, SOLUTION_VERSION, AWS_REGION
} = process.env;
const { sleep, getExponentialBackoffTimeInMS } = require('../utils/helper-functions');
const oneMinuteInMS = 1000 * 60;
const maxUserImportCSV = 500000;    // max 500k users per import job
const maxUploadByteSize = 100000000; // max 100mb file size per import job
const axios = require('axios');
const os = require('os');
const shouldSendMetric = (SEND_METRIC === 'Yes');
const { sendAnonymousMetric } = require('../utils/metrics');

/**
 * Imports users into the new user pool
 * @param {object} event 
 */
exports.handler = async (event, context) => {
    console.log(`Received event: ${JSON.stringify(event, null, 2)}`);
    const { Context, Input } = event;
    let result = { ...Input };
    let StateName = '';
    let newUserPoolId;
    try {
        newUserPoolId = Context.Execution.Input.NewUserPoolId.trim();
        if (!newUserPoolId) {
            throw new Error('Unable to determine the new user pool ID');
        }
    } catch (err) {
        console.error(err);
        throw new Error('Unable to determine the new user pool ID');
    }

    if (Context?.State) {
        StateName = Context.State.Name;
        result.StateName = StateName;
    }

    switch (StateName) {
        case 'ImportNewUsers':
        case 'Parallel: ImportNewUsers':
            result = { ...result, ... (await importUsers(context, newUserPoolId)) };
            break;
        case 'CheckUserImportJob':
        case 'Parallel: CheckUserImportJob':
            result = { ...result, ... (await checkUserImportJob(Input.ImportJobId, newUserPoolId)) };
            break;
        default:
            throw new Error(`Unknown StateName: ${StateName}`);
    }

    console.log(`Result: ${JSON.stringify(result)}`);
    return { result };
};



let numNewUsersToImport;
let userImportCSVHeaders;
let userImportCSV;
let userImportCSVByteSize;
let maxUploadByteSizeReached;
let userImportMappingFile;

async function checkCSVHeaders(newUserPoolId){
    if (!userImportCSVHeaders || userImportCSVHeaders.length === 0) {
        userImportCSVHeaders = await getCSVHeader(newUserPoolId);
        userImportCSV += formatCsvHeader(userImportCSVHeaders);
        userImportCSVByteSize += Buffer.byteLength(userImportCSV);
        maxUploadByteSizeReached = (userImportCSVByteSize >= maxUploadByteSize);
    }
}

async function processReceivedMessages(newUserPoolId, receiveMessageResult, output){
    if (receiveMessageResult.Messages?.length > 0) {
        console.log(`Read ${receiveMessageResult.Messages.length} message(s) off the queue`);
        output.QueueEmpty = false;
        const deleteMessageBatchParams = { QueueUrl: NEW_USERS_QUEUE_URL, Entries: [] };

        await checkCSVHeaders(newUserPoolId);

        for (const message of receiveMessageResult.Messages) {
            const userData = JSON.parse(message.Body);
            const userCSVLine = formatUserToCsvLine(userImportCSVHeaders, userData);
            const lineSize = Buffer.byteLength(userCSVLine);

            //Check if adding the next line will put the upload over the limit
            if (!maxUploadByteSizeReached) {
                maxUploadByteSizeReached = (lineSize + userImportCSVByteSize) >= maxUploadByteSize;
            }

            if ((!maxUploadByteSizeReached) && (numNewUsersToImport < maxUserImportCSV)) {
                userImportCSV += userCSVLine;
                userImportCSVByteSize += lineSize;
                userImportMappingFile += `${numNewUsersToImport + 1},${getUserSub(userData)}\n`;
                numNewUsersToImport++;
                deleteMessageBatchParams.Entries.push({ Id: message.MessageId, ReceiptHandle: message.ReceiptHandle });
            }
        }

        if (deleteMessageBatchParams.Entries.length > 0) {
            console.log(`Deleting a batch of ${deleteMessageBatchParams.Entries.length} message(s) from the New User Queue`);
            await sqs.deleteMessageBatch(deleteMessageBatchParams);
            console.log('Message batch deleted');
        }
    } else {
        console.log('No messages in queue');
        output.QueueEmpty = true;
    }
}
/**
 * Reads messages from the New Users Queue and creates a CSV import job to add them to the primary user pool
 * @param {object} context Lambda context
 * @param {string} newUserPoolId The ID of the import user pool
 */
const importUsers = async (context, newUserPoolId) => {

    const output = { ImportJobStatus: '', QueueEmpty: true };
    numNewUsersToImport = 0;
    userImportCSVHeaders = [];
    userImportCSV = '';
    userImportCSVByteSize = 0;
    maxUploadByteSizeReached = (userImportCSVByteSize < maxUploadByteSize);
    userImportMappingFile = 'userImportCsvLineNumber,userSub\n';

    do {
        const receiveMessageParams = { QueueUrl: NEW_USERS_QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 };
        console.log(`Getting messages off New Users Queue: ${JSON.stringify(receiveMessageParams)}`);
        const receiveMessageResult = await sqs.receiveMessage(receiveMessageParams);

        await processReceivedMessages(newUserPoolId, receiveMessageResult, output);

    } while (!output.QueueEmpty && !maxUploadByteSizeReached && numNewUsersToImport < maxUserImportCSV && context.getRemainingTimeInMillis() > oneMinuteInMS);

    if (numNewUsersToImport > 0) {
        console.log(`Going to create a job to import ${numNewUsersToImport} user(s)`);
        const userImportJobDetails = await runUserImportJob(userImportCSV, userImportMappingFile, newUserPoolId);
        output.ImportJobId = userImportJobDetails.JobId;
        output.ImportJobStatus = userImportJobDetails.Status;

        // Set to false so the queue is checked again after the user import job is complete
        output.QueueEmpty = false;
    }

    return output;
};

/**
 * Gets the CSV header for the user import job
 */
const getCSVHeader = async (newUserPoolId) => {
    const params = { UserPoolId: newUserPoolId };
    console.log(`Getting CSV Header: ${JSON.stringify(params)}`);
    const response = await cognitoISP.getCSVHeader(params);
    console.log(`Got CSV Header: ${JSON.stringify(response)}`);
    return response.CSVHeader;
};

/**
 * Formats the CSV header array into a comma-separated string
 * @param {string[]} csvHeaderArray An array of CSV headers returned by the getCSVHeader function
 */
const formatCsvHeader = (csvHeaderArray) => {
    const formattedHeader = csvHeaderArray.join(',') + os.EOL;
    console.log(`Formatted CSV header: ${formattedHeader}`);
    return formattedHeader;
};

/**
 * Formats user data object into a line for the user import CSV file
 * @param {string[]} csvHeaderArray An array of CSV headers returned by the getCSVHeader function
 * @param {object} userData The data for the user that will be formatted into the CSV line
 */
const formatUserToCsvLine = (csvHeaderArray, userData) => {
    let userLine = '';

    for (let header of csvHeaderArray) {
        let headerValue = '';
        switch (header) {
            case 'cognito:username':
                headerValue = `${userData.pseudoUsername}`;
                break;
            case 'cognito:mfa_enabled':
                headerValue = `false`;
                break;
            case 'email_verified':
                const emailVerified = userData.userAttributes.find(attr => attr.Name === header);
                headerValue = `${emailVerified ? emailVerified.Value : 'false'}`;
                break;
            case 'phone_number_verified':
                const phoneVerified = userData.userAttributes.find(attr => attr.Name === header);
                headerValue = `${phoneVerified ? phoneVerified.Value : 'false'}`;
                break;
            default:
                const matchingAttribute = userData.userAttributes.find(attr => attr.Name === header);
                headerValue = `${matchingAttribute ? matchingAttribute.Value : ''}`;
                break;
        }

        // Add a slash before each comma in the header value so the 
        // user import job is able to parse the CSV correctly
        headerValue = headerValue.replace(/,/g, '\\,');
        userLine += `${headerValue},`;
    }

    // Replace trailing comma with an EOL character
    return userLine.slice(0, -1) + os.EOL;
};

/**
 * Returns the Cognito-generated unique user identifier (sub) attribute
 * @param {object} userData The data for the user that will be formatted into the CSV line
 */
const getUserSub = (userData) => {
    let subValue = null;

    let subAttribute = userData.userAttributes.find(attr => attr.Name === 'sub');
    if (subAttribute) {
        subValue = subAttribute.Value;
    }

    if (!subValue) {
        throw new Error('Unable to extract user\'s sub attribute');
    }

    return subValue;
};

/**
 * Uploads the supplied CSV and starts the user import job
 * @param {string} csv The CSV file that will be used with the import job
 * @param {string} userImportMappingFile The mapping file that will be used to troubleshoot failed user import jobs
 * @param {string} newUserPoolId The ID of the import user pool
 */
const runUserImportJob = async (csv, userImportMappingFile, newUserPoolId) => {
    const createUserImportJobParams = {
        CloudWatchLogsRoleArn: USER_IMPORT_CLOUDWATCH_ROLE_ARN,
        UserPoolId: newUserPoolId,
        JobName: 'cognito-user-profiles-export-reference-architecture'
    };

    console.log(`Creating user import job: ${JSON.stringify(createUserImportJobParams)}`);
    const createUserImportJobResponse = await cognitoISP.createUserImportJob(createUserImportJobParams);
    console.log(`User import job created`);

    const { JobId, PreSignedUrl } = createUserImportJobResponse.UserImportJob;

    console.log(`Uploading user import job mapping file to S3 bucket (${USER_IMPORT_JOB_MAPPING_FILES_BUCKET})`);
    await s3.putObject({
        Bucket: USER_IMPORT_JOB_MAPPING_FILES_BUCKET,
        Key: `${JobId}-user-mapping.csv`,
        ServerSideEncryption: 'AES256',
        Body: userImportMappingFile
    });
    console.log('User import job mapping file uploaded');

    console.log('Uploading CSV for user import job...');
    const options = {
        maxBodyLength: maxUploadByteSize,
        maxContentLength: maxUploadByteSize,
        headers: { 'x-amz-server-side-encryption': 'aws:kms' }
    };
    await axios.put(PreSignedUrl, csv, options);
    console.log('CSV uploaded');

    let numAttempts = 1;
    let Status;
    const maxAttempts = 5;
    let jobStarted = false;
    while (!jobStarted && numAttempts < maxAttempts) {
        try {
            const startUserImportJobParams = { UserPoolId: newUserPoolId, JobId: JobId };
            console.log(`Starting user import job: ${JSON.stringify(startUserImportJobParams)}`);
            const startUserImportJobResponse = await cognitoISP.startUserImportJob(startUserImportJobParams);
            Status = startUserImportJobResponse.UserImportJob.Status;
            console.log(`User import job started: ${JobId} (${Status})`);
            jobStarted = true;
        } catch (err) {
            console.error(err);
            const sleepTimeInMs = getExponentialBackoffTimeInMS(100, numAttempts, 10000, false);
            numAttempts++;
            console.log(`Sleeping for ${sleepTimeInMs} milliseconds and will attempt to run the user import job again. That will be attempt #${numAttempts}`);
            await sleep(0, sleepTimeInMs);
        }
    }

    return { JobId: JobId, Status: Status };
};

/**
 * Returns the status of the Cognito User Import job matching the supplied jobId
 * @param {string} jobId The ID of the job to check
 * @param {string} newUserPoolId The ID of the import user pool
 */
const checkUserImportJob = async (jobId, newUserPoolId) => {
    const output = { ImportJobId: jobId };
    const describeUserImportJobParams = {
        UserPoolId: newUserPoolId,
        JobId: jobId
    };

    console.log(`Describing user import job: ${JSON.stringify(describeUserImportJobParams)}`);
    const response = await cognitoISP.describeUserImportJob(describeUserImportJobParams);
    console.log(JSON.stringify(response));

    if (response.UserImportJob) {
        if (shouldSendMetric) {
            if (response.UserImportJob.Status !== 'Pending' && response.UserImportJob.Status !== 'InProgress') {
                await sendAnonymousMetric(SOLUTION_ID, SOLUTION_VERSION, METRICS_ANONYMOUS_UUID, {
                    EventType: 'user-import-job-ended',
                    EventDetails: {
                        JobStatus: response.UserImportJob.Status,
                        CreationDate: response.UserImportJob.CreationDate,
                        StartDate: response.UserImportJob.StartDate,
                        CompletionDate: response.UserImportJob.CompletionDate,
                        CompletionMessage: response.UserImportJob.CompletionMessage,
                        Region: AWS_REGION
                    }
                });
            }
        }

        switch (response.UserImportJob.Status) {
            case 'Pending':
            case 'InProgress':
                console.log('Job has not completed yet');
                break;
            case 'Succeeded':
                console.log('Job completed successfully');
                break;
            default:
                throw new Error(`User import job with ID "${response.UserImportJob.JobId}" was detected to have a status of "${response.UserImportJob.Status}" in ${AWS_REGION}.\n\nPlease check the CloudWatch logs for this Cognito user import job and use the mapping file (${response.UserImportJob.JobId}-user-mapping.csv) that has been saved in this the solution's S3 bucket (${USER_IMPORT_JOB_MAPPING_FILES_BUCKET}) to cross-reference the line numbers reported the user import job CloudWatch logs`);
        }
    }

    output.ImportJobStatus = response.UserImportJob.Status;
    return output;
};

