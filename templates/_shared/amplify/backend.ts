import { defineBackend } from '@aws-amplify/backend'
import { Effect, PolicyStatement, AnyPrincipal } from 'aws-cdk-lib/aws-iam'
import type { CfnBucket } from 'aws-cdk-lib/aws-s3'
import { Duration, Stack } from 'aws-cdk-lib'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'

import { auth } from './auth/resource.js'
import { data } from './data/resource.js'
import { storage } from './storage/resource.js'
import { postConfirmation } from './auth/post-confirmation/resource.js'
import { eventDispatcher } from './events/dispatcher/resource.js'
import { processorTrusted } from './events/processor-trusted/resource.js'
import { processorUntrusted } from './events/processor-untrusted/resource.js'
import { apiKeyRenewer } from './functions/api-key-renewer/resource.js'

const backend = defineBackend({
  auth,
  data,
  storage,
  postConfirmation,
  eventDispatcher,
  processorTrusted,
  processorUntrusted,
  apiKeyRenewer,
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

// --- Auth: relax Cognito password policy to length-only ---
//
// `defineAuth` defaults to the Cognito-recommended policy: 8+ chars
// AND uppercase AND lowercase AND number AND symbol. That's stricter
// than the admin UX warrants for a single-tenant CMS — we want
// "minimum 8 characters" full stop. Override directly on the CFN
// user pool.
const cfnUserPool = backend.auth.resources.cfnResources.cfnUserPool
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: false,
    requireUppercase: false,
    requireNumbers: false,
    requireSymbols: false,
    temporaryPasswordValidityDays: 7,
  },
}

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

// 1. Enable streams on the Post and KvStore tables. Amplify Gen 2 wraps
//    each table in a custom resource (AmplifyDynamoDbTable), so we set
//    the stream spec on the cfnResources entry rather than on a stock
//    CfnTable.
const postTable = backend.data.resources.tables['Post']
const cfnPostTable = backend.data.resources.cfnResources.amplifyDynamoDbTables['Post']
cfnPostTable.streamSpecification = { streamViewType: 'NEW_AND_OLD_IMAGES' }

const kvTable = backend.data.resources.tables['KvStore']
const cfnKvTable = backend.data.resources.cfnResources.amplifyDynamoDbTables['KvStore']
cfnKvTable.streamSpecification = { streamViewType: 'NEW_AND_OLD_IMAGES' }
// DynamoDB TTL: rows whose `ttl` attribute is past `now` get garbage
// collected (≤48h delay). Lets KvStore double as a cache.
cfnKvTable.timeToLiveSpecification = { attributeName: 'ttl', enabled: true }

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
// Also dispatch KvStore changes so site-settings updates trigger the
// S3 cache rebuild. The dispatcher inspects the row's PK and only
// emits events for `siteconfig:*` items.
dispatcherFn.addEventSource(
  new DynamoEventSource(kvTable, {
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
// KvStore: trusted processor needs to read site settings (to expand
// the cache to S3 on update events). No write needed — settings are
// written from the admin UI via AppSync.
kvTable.grantReadData(trustedFn)
// S3 grant is bucket-wide for `public/plugins/*` rather than per-plugin
// prefix. Rationale:
//   1. v0.1 trusted plugins are first-party only (see ARCHITECTURE.md §4),
//      so cross-plugin tampering isn't a threat model we're defending.
//   2. Per-plugin enumeration (`public/plugins/{name}/*` for each name)
//      doesn't scale — IAM inline policies cap at 10 KiB, breaking around
//      50 plugins; incompatible with the v0.2 marketplace direction.
//   3. The real key namespacing is enforced in code: `writePublicAsset`
//      always prefixes with the calling plugin's name, so a plugin can't
//      overwrite a sibling's path without bypassing the runtime context.
//   4. Strict per-plugin isolation is planned for v0.2 via plugin-per-Lambda
//      with capability-based dynamic IAM (see roadmap).
trustedFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['s3:PutObject', 's3:DeleteObject'],
    resources: [`${backend.storage.resources.bucket.bucketArn}/public/plugins/*`],
  })
)
trustedFn.addEnvironment('AMPLESS_BUCKET_NAME', backend.storage.resources.bucket.bucketName)
trustedFn.addEnvironment('AMPLESS_POST_TABLE', postTable.tableName)
trustedFn.addEnvironment('AMPLESS_KV_TABLE', kvTable.tableName)

// 6. Untrusted processor: SQS only, zero AWS data permissions.
const untrustedFn = backend.processorUntrusted.resources.lambda
untrustedFn.addEventSource(new SqsEventSource(untrustedQueue, { batchSize: 5 }))

// --- AppSync API key auto-renewal ---
//
// The public read path (listPublishedPosts / getPublishedPost / listPostsByTag)
// authenticates with an AppSync API key because `a.handler.custom` doesn't
// support `allow.guest()` in Amplify Gen 2 (verified 2026-04). The key has a
// 365-day TTL and the public site silently 401s the moment it expires.
//
// To eliminate the rotation runbook, a monthly EventBridge rule pings a Lambda
// that calls UpdateApiKey to push `expires` back to "now + 364 days". The key
// id stays the same — amplify_outputs.json values remain valid, no rebuild
// of the Next.js app required.
const graphqlApi = backend.data.resources.cfnResources.cfnGraphqlApi
const apiKeyRenewerFn = backend.apiKeyRenewer.resources.lambda

apiKeyRenewerFn.addEnvironment('APPSYNC_API_ID', graphqlApi.attrApiId)
apiKeyRenewerFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['appsync:ListApiKeys', 'appsync:UpdateApiKey'],
    // attrArn is `arn:aws:appsync:{region}:{account}:apis/{apiId}`; the API
    // key resources live underneath, so a wildcard suffix covers them.
    resources: [graphqlApi.attrArn, `${graphqlApi.attrArn}/*`],
  })
)

// Schedule: run on the 1st of every month at 03:00 UTC. Cadence isn't
// load-bearing; even quarterly would keep ≥ ~275 days of headroom. Monthly
// just gives wide margin on missed invocations.
new Rule(Stack.of(apiKeyRenewerFn), 'ApiKeyRenewerSchedule', {
  schedule: Schedule.cron({ minute: '0', hour: '3', day: '1', month: '*', year: '*' }),
  targets: [new LambdaFunction(apiKeyRenewerFn)],
})
