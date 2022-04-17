const {v4: uuid} = require('uuid');
const _ = require('lodash');
const audiosprite = require('audiosprite');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');

const s3 = new AWS.S3();
const polly = new AWS.Polly();

const DEFAULT_BREAK_TIME_IN_SECS = 0;
const BASE_DIR = '/mnt/fs';
const INPUT_BUCKET = process.env.INPUT_BUCKET;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;
const OUTPUT_FILE_NAME = 'output';
const OUTPUT_FILE_FORMAT = 'mp3';
const VOICE_IDS = ['Salli', 'Joanna', 'Kendra', 'Ivy', 'Kimberly', 'Kevin', 'Matthew', 'Justin', 'Joey'];

exports.handler = async (event) => {
    const s3InputKey = event['s3InputKey'];

    if (!s3InputKey) {
        throw new Error('s3InputKey is missing');
    }

    const text = await getS3ObjectByKeyAndBucket(s3InputKey, INPUT_BUCKET);

    const voiceRecords = getVoiceRecords(text);

    const filePrefix = uuid();

    console.log('filePrefix: ' + filePrefix);

    const startTaskResponses = await Promise.all(startSpeechSynthesis(voiceRecords, OUTPUT_BUCKET, filePrefix));

    const outputUris = await getAudionOutputUris(startTaskResponses);

    const targetAudionResponse = await concatAudios(filePrefix, outputUris, OUTPUT_BUCKET);

    const targetAudioKey = `${targetAudionResponse.prefix}/${targetAudionResponse.filename}`;
    const targetAudionLocalFile = `${BASE_DIR}/${targetAudioKey}`;

    try {
        await putS3Object(targetAudionLocalFile, OUTPUT_BUCKET, targetAudioKey);
        return {
            s3OutputKey: targetAudioKey,
            s3OutputBucket: OUTPUT_BUCKET,
        }
    } catch (error) {
        throw error;
    } finally {
        const tempWorkDir = path.join(BASE_DIR, filePrefix)
/*        fs.readdirSync(tempWorkDir).forEach(file => {
            console.log('File: ' + file);
        });*/

        fs.rmSync(tempWorkDir, {
            recursive: true,
            force: true
        });
    }
};

const waitInMillis = async (timeout) => {
    return new Promise((resolve, reject) => {
        try {
            setTimeout(resolve, timeout);
        } catch (err) {
            reject(err);
        }
    });
};

const startSpeechSynthesis = (voiceRecords, outputBucketName, prefix) => {
    return voiceRecords.map(record => {
        const input = {
            OutputFormat: OUTPUT_FILE_FORMAT,
            OutputS3BucketName: outputBucketName,
            OutputS3KeyPrefix: prefix + '/',
            Engine: 'neural',
            Text: record.text.value,
            VoiceId: record.voiceId
        }

        return polly.startSpeechSynthesisTask(input).promise().then(response => {
            return {
                index: record.global_index,
                task: response.SynthesisTask
            }
        });
    });
}

const getTaskStatuses = (taskIds) => {
    try {
        return taskIds.map(taskId =>
            polly
                .getSpeechSynthesisTask({TaskId: taskId})
                .promise()
                .then(response => response.SynthesisTask.TaskStatus))
    } catch (error) {
        throw error;
    }
}

const getVoiceRecords = (text) => {
    return text
        .split('@')
        .map(phrase => phrase.trim()).filter(phrase => phrase !== '')
        .map((rawPhrase, i) => {
            const voiceId = capitalizeFirstLetter(getFirstWord(rawPhrase));

            if (!VOICE_IDS.includes(voiceId)) {
                throw new Error(`Wrong Voice ID: ${voiceId}`);
            }

            return {
                global_index: i,
                text: {
                    value: removeFirstWord(rawPhrase).trim()
                },
                voiceId
            }
        });
}

const removeFirstWord = (str) => {
    const indexOfSpace = str.indexOf(' ');

    if (indexOfSpace === -1) {
        return '';
    }

    return str.substring(indexOfSpace + 1);
}

const capitalizeFirstLetter = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const getFirstWord = (text) => text.split(' ')[0];

const getAudionOutputUris = async (startTaskResponses) => {
    let statuses;

    do {
        await waitInMillis(5000);
        statuses = await Promise.all(getTaskStatuses(startTaskResponses.map(startTaskResponse => startTaskResponse.task.TaskId)));
    } while (statuses.includes('inProgress') || statuses.includes('scheduled'));

    const sortedStartTaskResponses = _.orderBy(startTaskResponses, 'index');

    return sortedStartTaskResponses.map(startTaskResponse => startTaskResponse.task.OutputUri);
}

const downloadS3Object = (key, fileName, outputBucketName) => {
    const params = {
        Bucket: outputBucketName,
        Key: key
    };
    const readStream = s3.getObject(params).createReadStream();

    const writeStream = fs.createWriteStream(path.join(BASE_DIR, fileName));

    return new Promise(((resolve, reject) => {
        writeStream.once('close', resolve);
        readStream.pipe(writeStream);
    }));
}

const concatAudios = async (filePrefix, s3Urls, outputBucketName) => {
    const prefix = s3Urls[0].split('/')[4];

    const LOCAL_DIR = path.join(`${BASE_DIR}/${prefix}`)

    if (!fs.existsSync(LOCAL_DIR)) {
        fs.mkdirSync(LOCAL_DIR);
    }

    let i = 0;

    for (const s3Url of s3Urls) {
        const s3UrlParts = s3Url.split('/')
        const s3Key = s3UrlParts.slice(4).join('/')
        await downloadS3Object(s3Key, `${prefix}/${i}.${OUTPUT_FILE_FORMAT}`, outputBucketName);
        i++;
    }

    const files = s3Urls.map((url, i) => `${LOCAL_DIR}/${i}.${OUTPUT_FILE_FORMAT}`);
    const opts = {output: `${LOCAL_DIR}/${OUTPUT_FILE_NAME}`, export: OUTPUT_FILE_FORMAT, 'gap': DEFAULT_BREAK_TIME_IN_SECS};

    return new Promise((resolve, reject) => {
        audiosprite(files, opts, function (err, result) {
            if (err) return reject(err);
            resolve({
                filename: `${OUTPUT_FILE_NAME}.${OUTPUT_FILE_FORMAT}`,
                prefix,
                info: result
            });
        });
    });
};


const putS3Object = async (localFile, targetBucket, targetFilename) => {
    return s3.putObject({
        Bucket: targetBucket,
        Body: fs.readFileSync(localFile),
        Key: targetFilename
    }).promise();
}


const getS3Object = async (s3InputUri) => {
    const parts = s3InputUri.split('/');
    const bucket = parts[2];
    const key = parts.slice(-(parts.length - 3)).join('/');

    return s3.getObject({
        Bucket: bucket,
        Key: key
    }).promise().then(response => response.Body.toString());
}

const getS3ObjectByKeyAndBucket = async (key, bucket) => {
    return s3.getObject({
        Bucket: bucket,
        Key: key
    }).promise().then(response => response.Body.toString());
}
