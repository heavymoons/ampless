import { defineBackend } from '@aws-amplify/backend'
import { Effect, PolicyStatement, AnyPrincipal } from 'aws-cdk-lib/aws-iam'
import type { CfnBucket } from 'aws-cdk-lib/aws-s3'
import { Duration } from 'aws-cdk-lib'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'

import { auth } from './auth/resource.js'
import { data } from './data/resource.js'
import { storage } from './storage/resource.js'
import { postConfirmation } from './auth/post-confirmation/resource.js'
import { eventDispatcher } from './events/dispatcher/resource.js'
import { processorTrusted } from './events/processor-trusted/resource.js'
import { processorUntrusted } from './events/processor-untrusted/resource.js'

const backend = defineBackend({
  auth,
  data,
  storage,
  postConfirmation,
  eventDispatcher,
  processorTrusted,
  processorUntrusted,
})

// --- Storage: make `public/*` directly fetchable from the browser ---
const cfnBucket = backend.storage.resources.cfnResources.cfnBucket as CfnBucket
cfnBucket.publicAccessBlockConfiguration = {
  blockPublicAcls: true,
  blockPublicPolicy: false,
  ignorePublicAcls: true,
  restrictPublicBuckets: false,
}

backend.storage.resources.bucket.addToResourcePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    principals: [new AnyPrincipal()],
    actions: ['s3:GetObject'],
    resources: [`${backend.storage.resources.bucket.bucketArn}/public/*`],
  })
)

// --- Auth: post-confirmation Lambda permissions ---
backend.postConfirmation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['cognito-idp:AdminAddUserToGroup', 'cognito-idp:ListUsersInGroup'],
    resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
  })
)

// --- Event system: DynamoDB Streams → SQS (×2) → trust_level Lambdas ---
//
// Architecture:
//   Post Stream → event-dispatcher → SQS-trusted    → processor-trusted
//                                  → SQS-untrusted  → processor-untrusted
//
// Each processor's IAM role is scoped to what its plugins are allowed to
// touch (trusted = read posts + write own S3 path; untrusted = nothing).
// Failures retry up to 3 times then go to a shared DLQ.

// 1. Enable streams on the Post table. (Page/Media to be added when those
//    events have plugin consumers.) Amplify Gen 2 wraps the table in a
//    custom resource (AmplifyDynamoDbTable), so we set the stream spec on
//    the cfnResources entry rather than on a stock CfnTable.
const postTable = backend.data.resources.tables['Post']
const cfnPostTable = backend.data.resources.cfnResources.amplifyDynamoDbTables['Post']
cfnPostTable.streamSpecification = { streamViewType: 'NEW_AND_OLD_IMAGES' }

const eventsStack = backend.createStack('amplessEvents')

// 2. Shared dead-letter queue.
const eventsDlq = new Queue(eventsStack, 'EventsDlq', {
  retentionPeriod: Duration.days(14),
})

// 3. Per-trust-level main queues.
const trustedQueue = new Queue(eventsStack, 'TrustedEventsQueue', {
  visibilityTimeout: Duration.seconds(120),
  deadLetterQueue: { maxReceiveCount: 3, queue: eventsDlq },
})
const untrustedQueue = new Queue(eventsStack, 'UntrustedEventsQueue', {
  visibilityTimeout: Duration.seconds(60),
  deadLetterQueue: { maxReceiveCount: 3, queue: eventsDlq },
})

// 4. Dispatcher Lambda: Stream → both SQS queues.
const dispatcherFn = backend.eventDispatcher.resources.lambda
dispatcherFn.addEventSource(
  new DynamoEventSource(postTable, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 10,
    retryAttempts: 3,
    bisectBatchOnError: true,
  })
)
trustedQueue.grantSendMessages(dispatcherFn)
untrustedQueue.grantSendMessages(dispatcherFn)
dispatcherFn.addEnvironment('TRUSTED_QUEUE_URL', trustedQueue.queueUrl)
dispatcherFn.addEnvironment('UNTRUSTED_QUEUE_URL', untrustedQueue.queueUrl)

// 5. Trusted processor: SQS → plugin handlers, with read on posts + write
//    on own S3 plugin paths.
const trustedFn = backend.processorTrusted.resources.lambda
trustedFn.addEventSource(new SqsEventSource(trustedQueue, { batchSize: 5 }))
// grantReadData covers the table itself but not its GSIs in Amplify's
// custom AmplifyDynamoDbTable. Add explicit access to byStatus and any
// future indexes via index/*.
postTable.grantReadData(trustedFn)
trustedFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['dynamodb:Query', 'dynamodb:Scan'],
    resources: [`${postTable.tableArn}/index/*`],
  })
)
trustedFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['s3:PutObject', 's3:DeleteObject'],
    resources: [`${backend.storage.resources.bucket.bucketArn}/public/plugins/*`],
  })
)
trustedFn.addEnvironment('AMPLESS_BUCKET_NAME', backend.storage.resources.bucket.bucketName)
trustedFn.addEnvironment('AMPLESS_POST_TABLE', postTable.tableName)

// 6. Untrusted processor: SQS only, zero AWS data permissions.
const untrustedFn = backend.processorUntrusted.resources.lambda
untrustedFn.addEventSource(new SqsEventSource(untrustedQueue, { batchSize: 5 }))
