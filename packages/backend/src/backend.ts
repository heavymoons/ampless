import { defineBackend } from '@aws-amplify/backend'
import { Effect, PolicyStatement, AnyPrincipal } from 'aws-cdk-lib/aws-iam'
import type { CfnBucket } from 'aws-cdk-lib/aws-s3'
import { Duration, Stack } from 'aws-cdk-lib'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import { FunctionUrlAuthType, HttpMethod, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'

// `defineBackend`'s parameter is a record of resources. We can't import
// stricter types (defineAuth / defineData / defineStorage / defineFunction
// return types) without coupling this factory to the host project's
// specific schema — and that schema is built dynamically via
// `extendAmplessSchema(a, customModels)` in the user's resource.ts.
// Use `Parameters<typeof defineBackend>[0]` to match defineBackend's own
// loose typing and let CDK / Amplify do its usual runtime wiring.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthResource = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataResource = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StorageResource = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FunctionResource = any

export interface DefineAmplessBackendOpts {
  auth: AuthResource
  data: DataResource
  storage: StorageResource
  postConfirmation: FunctionResource
  eventDispatcher: FunctionResource
  processorTrusted: FunctionResource
  processorUntrusted: FunctionResource
  apiKeyRenewer: FunctionResource
  userAdmin: FunctionResource
  mcpHandler: FunctionResource
}

// The return type of `defineBackend` is parameterised on the input
// resource record, and CDK's CloudFormation construct types refuse to
// be unified with our loose `any` resource entries. The caller never
// reads this through a typed handle in practice (everything happens
// via Amplify's `amplify_outputs.json` and the generated `Schema`
// client), so we surface the value as `unknown` and let consumers
// re-export it directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AmplessBackend = any

/**
 * The end-to-end ampless backend wiring, parameterised on the resource
 * objects so users only have to compose the imports.
 *
 * What it does, in order:
 *   1. Calls `defineBackend` with every Ampless resource.
 *   2. Opens up the S3 bucket to anonymous reads under `public/*`
 *      plus a permissive CORS rule for cross-origin asset fetches.
 *   3. Relaxes the Cognito password policy to length-only.
 *   4. Grants the post-confirmation Lambda permission to add
 *      newly-confirmed users to Cognito groups.
 *   5. Enables DynamoDB Streams on Post + KvStore, provisions
 *      Trusted/Untrusted SQS queues with a shared DLQ, wires the
 *      dispatcher Lambda to both streams and both queues, and
 *      grants the trusted processor scoped data / S3 access.
 *   6. Schedules the AppSync API key renewer to run monthly.
 *
 * The user-side `amplify/backend.ts` becomes:
 *
 *     import { defineAmplessBackend } from '@ampless/backend'
 *     import { auth } from './auth/resource'
 *     import { data } from './data/resource'
 *     // ...
 *     export default defineAmplessBackend({ auth, data, ... })
 */
export function defineAmplessBackend(opts: DefineAmplessBackendOpts): AmplessBackend {
  const backend = defineBackend({
    auth: opts.auth,
    data: opts.data,
    storage: opts.storage,
    postConfirmation: opts.postConfirmation,
    eventDispatcher: opts.eventDispatcher,
    processorTrusted: opts.processorTrusted,
    processorUntrusted: opts.processorUntrusted,
    apiKeyRenewer: opts.apiKeyRenewer,
    userAdmin: opts.userAdmin,
    mcpHandler: opts.mcpHandler,
  })

  // --- Storage: make `public/*` directly fetchable from the browser ---
  const cfnBucket = backend.storage.resources.cfnResources.cfnBucket as CfnBucket
  cfnBucket.publicAccessBlockConfiguration = {
    blockPublicAcls: true,
    blockPublicPolicy: false,
    ignorePublicAcls: true,
    restrictPublicBuckets: false,
  }

  // CORS so cross-origin asset loads work from the public site —
  // fonts referenced from CSS, ES modules with `crossorigin`, source
  // maps, fetch() / XMLHttpRequest reading the response body. Plain
  // `<link>` / `<script>` / `<img>` already work without CORS (no-CORS
  // loads), but anything that wants to *read* the bytes cross-origin
  // needs these headers. AllowedOrigins is `*` because uploads are
  // already public (the bucket policy grants anonymous s3:GetObject
  // on `public/*`); CORS just lets the browser read what's already
  // publicly fetchable.
  cfnBucket.corsConfiguration = {
    corsRules: [
      {
        allowedMethods: ['GET', 'HEAD'],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        maxAge: 3000,
      },
    ],
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

  // --- Auth: user-admin Lambda permissions ---
  //
  // Backs the admin UI's user-management page. Scoped wildcard on
  // userpool arn matches the post-confirmation pattern — the Lambda
  // reads `AMPLESS_USER_POOL_ID` at runtime and addresses one pool.
  backend.userAdmin.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
      ],
      resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
    })
  )
  backend.userAdmin.resources.lambda.addEnvironment(
    'AMPLESS_USER_POOL_ID',
    backend.auth.resources.userPool.userPoolId
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

  const mcpTokenTable = backend.data.resources.tables['McpToken']

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
  // PostTag: trusted processor owns the denormalized (tag × post)
  // index, rebuilt from the Post stream on every mutation. Write
  // access only — the public side reads via AppSync's listPostsByTag
  // resolver against the same table.
  const postTagTable = backend.data.resources.tables['PostTag']
  postTagTable.grantWriteData(trustedFn)
  // S3 grant is bucket-wide for `public/plugins/*` rather than per-plugin
  // prefix. Rationale:
  //   1. Trusted plugins are first-party only (see ARCHITECTURE.md §4),
  //      so cross-plugin tampering isn't a threat model we're defending.
  //   2. Per-plugin enumeration (`public/plugins/{name}/*` for each name)
  //      doesn't scale — IAM inline policies cap at 10 KiB, breaking around
  //      50 plugins, and that conflicts with the eventual marketplace
  //      direction.
  //   3. The real key namespacing is enforced in code: `writePublicAsset`
  //      always prefixes with the calling plugin's name, so a plugin can't
  //      overwrite a sibling's path without bypassing the runtime context.
  //   4. Strict per-plugin isolation is planned via plugin-per-Lambda with
  //      capability-based dynamic IAM (see roadmap).
  trustedFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [
        `${backend.storage.resources.bucket.bucketArn}/public/plugins/*`,
        // Built-in cache: rebuildSiteSettingsCache writes the single
        // JSON file the public site reads. Exact-match resource — a
        // wildcard like `public/site-settings/*` would NOT match the
        // single-file key `public/site-settings.json` and the
        // PutObject would fail silently with AccessDenied, so the
        // public site would never see admin-side theme / settings
        // changes.
        `${backend.storage.resources.bucket.bucketArn}/public/site-settings.json`,
      ],
    })
  )
  trustedFn.addEnvironment('AMPLESS_BUCKET_NAME', backend.storage.resources.bucket.bucketName)
  trustedFn.addEnvironment('AMPLESS_POST_TABLE', postTable.tableName)
  trustedFn.addEnvironment('AMPLESS_KV_TABLE', kvTable.tableName)
  trustedFn.addEnvironment('AMPLESS_POSTTAG_TABLE', postTagTable.tableName)

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

  // --- MCP HTTP endpoint ---
  //
  // Bearer auth + JSON-RPC tool dispatch. The handler reads the
  // `McpToken` DynamoDB table directly to validate
  // `Authorization: Bearer amk_...` (identifier = SHA-256 hash of
  // plaintext) and dispatches `tools/call` through the shared
  // `@ampless/mcp-server/tools` registry.
  //
  // AppSync IAM auth: the `allow.resource(mcpHandler)` clause in the
  // schema (Post + PostTag, via `mcpHandlerFunction: mcpHandler` in the
  // template's data/resource.ts) auto-grants this Lambda's role
  // `appsync:GraphQL` on the relevant types. No manual policy attach
  // needed — Amplify wires the IAM permissions when it sees a resource
  // grant on a model.
  const mcpHandlerFn = backend.mcpHandler.resources.lambda

  // McpToken: read the single row that backs each Bearer token. The
  // table is admin-only at the AppSync layer; the Lambda bypasses
  // AppSync and reads the row directly, which is why it gets a narrow
  // DDB GetItem grant instead of a `resource(...).to(['query'])` rule.
  mcpHandlerFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [mcpTokenTable.tableArn],
    })
  )
  mcpHandlerFn.addEnvironment('AMPLESS_MCP_TOKEN_TABLE', mcpTokenTable.tableName)
  // AppSync endpoint for the SigV4-signed GraphQL client.
  mcpHandlerFn.addEnvironment(
    'AMPLESS_APPSYNC_URL',
    backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl
  )
  // S3 PutObject for `upload_media`. Scope to `public/media/*` which
  // matches the prefix `buildMediaKey` always produces. The Lambda
  // execution role carries these credentials — no AWS_ACCESS_KEY_ID
  // env var needed in the function.
  mcpHandlerFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${backend.storage.resources.bucket.bucketArn}/public/media/*`],
    })
  )
  // Static-bundle MCP tools: PutObject + DeleteObject under
  // `public/static/*` (per-bundle prefix is `public/static/<slug>/`).
  // ListBucket is required for `upload_static_bundle` (wipe existing
  // prefix), `delete_static_file` (existence probe), and
  // `commit_static_post` (manifest rebuild from current prefix). The
  // ListBucket grant is bucket-scoped — IAM forbids attaching it to a
  // key — so we constrain it via an `s3:prefix` condition limited to
  // `public/static/*` so the role can't enumerate other paths.
  mcpHandlerFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [`${backend.storage.resources.bucket.bucketArn}/public/static/*`],
    })
  )
  mcpHandlerFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [backend.storage.resources.bucket.bucketArn],
      conditions: {
        StringLike: { 's3:prefix': ['public/static/*'] },
      },
    })
  )
  mcpHandlerFn.addEnvironment('AMPLESS_BUCKET_NAME', backend.storage.resources.bucket.bucketName)

  // Function URL: auth NONE because the handler does its own Bearer
  // validation. CORS open because MCP clients connect from arbitrary
  // origins (stdio clients ignore CORS but browser-based ones honour it).
  //
  // Don't list OPTIONS in allowedMethods even though the CDK
  // `HttpMethod` enum exposes it — the Lambda Function URL CFN
  // resource only accepts `* | GET | PUT | HEAD | POST | PATCH | DELETE`
  // and rejects OPTIONS at deploy time with a properties validation
  // error. Preflight is handled automatically by the Function URL
  // CORS layer; we just need to declare which "real" methods are
  // allowed.
  const mcpFunctionUrl = mcpHandlerFn.addFunctionUrl({
    authType: FunctionUrlAuthType.NONE,
    cors: {
      allowedOrigins: ['*'],
      allowedMethods: [HttpMethod.POST],
      allowedHeaders: ['*'],
      maxAge: Duration.hours(1),
    },
  })

  // Surface the endpoint URL in amplify_outputs.json under `custom.mcp`
  // so the admin UI can display "your MCP endpoint is X" and external
  // docs can pin it.
  backend.addOutput({
    custom: {
      mcp: {
        endpoint: mcpFunctionUrl.url,
      },
    },
  })

  return backend
}
