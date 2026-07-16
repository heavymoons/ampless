import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { createHash } from 'node:crypto'

import { tools, type StorageClient, type ToolContext } from '@ampless/mcp-server/tools'
import {
  dispatchJsonRpc,
  jsonRpcError,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_INTERNAL_ERROR,
  type JsonRpcRequest,
} from '@ampless/mcp-server/jsonrpc'
import { createMcpGraphqlClient } from './mcp-graphql-client.js'
import { createMcpStorageClient } from './mcp-storage-client.js'

/**
 * MCP HTTP endpoint Lambda. Bearer validation + JSON-RPC 2.0 tool
 * dispatch over AppSync IAM auth, including `upload_media`.
 *
 *   1. Reads the admin-only `McpToken` DynamoDB table directly
 *      (identifier = SHA-256 hex of plaintext) to validate
 *      `Authorization: Bearer amk_...`. The Lambda has a narrow IAM
 *      grant: `dynamodb:GetItem` and `dynamodb:UpdateItem` on the
 *      McpToken table — no AppSync round-trip for token validation.
 *   2. Parses the incoming JSON-RPC envelope by hand (no MCP SDK
 *      stdio transport in a Lambda runtime — overkill for the three
 *      verbs we actually need).
 *   3. Dispatches `tools/call` through the shared `@ampless/mcp-server/tools`
 *      registry. The GraphqlClient implementation hits AppSync with
 *      SigV4 (`AWS_IAM` auth mode), gated by `allow.resource(mcpHandler)
 *      .to(['query', 'mutate'])` on Post / PostTag in the schema.
 *   4. `upload_media` decodes the base64 body inline and uploads to S3
 *      using the Lambda execution role (s3:PutObject on public/media/*).
 *      Payload limit ~6 MB (base64-inflated) covers typical CMS images;
 *      large files should use the stdio CLI.
 *
 * Function URL event format: Lambda Function URLs emit API Gateway
 * HTTP v2 events (https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html#urls-payloads).
 * Headers arrive lowercased.
 */

interface FunctionUrlEvent {
  headers?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
  requestContext?: { http?: { method?: string } }
}

interface FunctionUrlResult {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

/**
 * Row shape returned by the McpToken DynamoDB table. Fields are
 * first-class (no nested AWSJSON `value`) because each one is a typed
 * column on the AppSync model. Dates are ISO 8601 strings — Amplify
 * stores `a.datetime()` as a string in DynamoDB.
 */
interface McpTokenRow {
  hash: string
  prefix: string
  createdBy: string
  createdByEmail: string
  issuedAt: string
  lastUsedAt?: string | null
  expiresAt?: string | null
  revokedAt?: string | null
}

// JSON-RPC envelope types, error codes, wire helpers, and the method
// dispatch (`dispatchJsonRpc`) now live in `@ampless/mcp-server/jsonrpc`
// so the admin (this Lambda) and public (runtime, PR-8) transports share
// one implementation. This handler keeps only HTTP framing + auth.

// Minimum gap between `lastUsedAt` writes per token. High-frequency MCP
// requests (e.g. a tool loop) would otherwise hammer DDB with UpdateItem
// on every call. One write per 60 seconds is fine for the UI display.
const LAST_USED_THROTTLE_MS = 60_000

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[mcp-handler] missing required env var ${name}`)
  return v
}

const MCP_TOKEN_TABLE = requireEnv('AMPLESS_MCP_TOKEN_TABLE')
const APPSYNC_URL = requireEnv('AMPLESS_APPSYNC_URL')
const BUCKET_NAME = requireEnv('AMPLESS_BUCKET_NAME')
const AWS_REGION = process.env['AWS_REGION'] ?? 'us-east-1'
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// All tools are available over HTTP, including `upload_media` which
// uses inline base64 (decoded + S3-uploaded by the Lambda).
const HTTP_TOOLS = tools

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

function jsonResponse(statusCode: number, body: unknown): FunctionUrlResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * Validate a Bearer token by:
 *  1. Hashing the plaintext to its SHA-256 hex.
 *  2. GetItem on the McpToken table at { hash }.
 *  3. Rejecting if missing, revoked, or expired.
 * Returns the row on success, or `null` on any failure (caller
 * surfaces the same 401 either way — exposing which check failed would
 * leak whether a hash exists in storage).
 */
async function validateBearer(plaintext: string): Promise<McpTokenRow | null> {
  const hash = hashToken(plaintext)
  const res = await ddb.send(
    new GetCommand({
      TableName: MCP_TOKEN_TABLE,
      Key: { hash },
    })
  )
  const row = res.Item as McpTokenRow | undefined
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null
  return row
}

/**
 * Write `lastUsedAt = now` on the token row, throttled to one write per
 * LAST_USED_THROTTLE_MS via a ConditionExpression:
 *
 *   attribute_not_exists(lastUsedAt)
 *     OR attribute_type(lastUsedAt, NULL)
 *     OR lastUsedAt < :threshold
 *
 * The middle branch is load-bearing: the admin-side `createToken`
 * stores fresh rows with `lastUsedAt: null` (see
 * `packages/admin/src/lib/mcp-token-storage.ts`), which DDB persists
 * as `{ NULL: true }`. Without the `attribute_type` check the row's
 * first validation would hit `attribute_not_exists = false` (the
 * column exists) and `null < :threshold = false` (NULL is not
 * orderable against a string), so the very first lastUsedAt update
 * would silently fail with ConditionalCheckFailedException and the
 * column would stay null forever.
 *
 * ConditionalCheckFailedException means the row was already updated
 * within the throttle window (or the column was set to a fresh
 * timestamp between our GetItem and UpdateItem on the same request)
 * — that is expected and silently skipped. Any other error is logged
 * (fail-open: the MCP request continues regardless).
 */
async function touchLastUsedAt(hash: string): Promise<void> {
  const now = new Date()
  const threshold = new Date(now.getTime() - LAST_USED_THROTTLE_MS).toISOString()
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: MCP_TOKEN_TABLE,
        Key: { hash },
        UpdateExpression: 'SET lastUsedAt = :now',
        ConditionExpression:
          'attribute_not_exists(lastUsedAt) OR attribute_type(lastUsedAt, :nullType) OR lastUsedAt < :threshold',
        ExpressionAttributeValues: {
          ':now': now.toISOString(),
          ':threshold': threshold,
          ':nullType': 'NULL',
        },
      })
    )
  } catch (err) {
    // ConditionalCheckFailedException = updated within the throttle window; skip silently.
    if (err instanceof ConditionalCheckFailedException) return
    console.error('[mcp-handler] failed to update lastUsedAt:', err)
  }
}

// Lazy clients: instantiated on first tools/call request so
// `initialize` / `tools/list` (which never touch AppSync or S3) don't
// pay the credential-chain lookup. Cached for the warm-Lambda lifetime.
let cachedCtx: ToolContext | null = null
function makeContext(): ToolContext {
  if (cachedCtx) return cachedCtx
  let storageClient: StorageClient | null = null
  const ctx: ToolContext = {
    graphql: createMcpGraphqlClient({ endpoint: APPSYNC_URL, region: AWS_REGION }),
    storage: () => {
      if (!storageClient) {
        storageClient = createMcpStorageClient({ bucket: BUCKET_NAME, region: AWS_REGION })
      }
      return storageClient
    },
  }
  cachedCtx = ctx
  return ctx
}

export const handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
  // CORS preflight — Function URL CORS config handles most headers, but
  // OPTIONS needs an explicit 204.
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, body: '' }
  }

  const authHeader = event.headers?.authorization ?? event.headers?.Authorization
  if (!authHeader) {
    return jsonResponse(401, { error: 'missing_authorization' })
  }
  const match = /^Bearer\s+(amk_[A-Za-z0-9_-]+)$/.exec(authHeader)
  if (!match) {
    return jsonResponse(401, { error: 'invalid_authorization' })
  }
  const plaintext = match[1]!

  const meta = await validateBearer(plaintext)
  if (!meta) {
    return jsonResponse(401, { error: 'invalid_token' })
  }

  // Throttled lastUsedAt update. Awaited so the write is bounded to
  // the request lifecycle — Lambda's default execution model drains
  // the event loop before freeze, but relying on that is fragile if
  // anyone later flips `callbackWaitsForEmptyEventLoop` or adopts a
  // streaming response style. `touchLastUsedAt` is fail-open
  // internally (catches and logs) so the await never blocks the
  // request on a DDB hiccup, and the 60 s ConditionExpression
  // ensures the wire latency is paid at most once per token per
  // minute.
  await touchLastUsedAt(meta.hash)

  // Parse JSON-RPC body.
  let req: JsonRpcRequest
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : event.body ?? ''
    if (!body) {
      return jsonResponse(400, jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Empty body'))
    }
    req = JSON.parse(body) as JsonRpcRequest
  } catch {
    return jsonResponse(400, jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'Parse error'))
  }

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return jsonResponse(
      400,
      jsonRpcError((req as { id?: JsonRpcRequest['id'] })?.id ?? null, JSON_RPC_INVALID_REQUEST, 'Invalid Request')
    )
  }

  try {
    const response = await dispatchJsonRpc(req, {
      tools: HTTP_TOOLS,
      getContext: makeContext,
      serverInfo: { name: 'ampless-mcp', version: '0.2' },
    })
    // A notification (JSON-RPC id absent, e.g. notifications/initialized)
    // gets no body — the shared dispatch returns null. Reply 202 Accepted
    // with an empty body rather than the old (protocol-violating) result.
    if (response === null) {
      return { statusCode: 202, body: '' }
    }
    return jsonResponse(200, response)
  } catch (err) {
    // Last-ditch catch: dispatchJsonRpc shouldn't throw for normal
    // tool errors (those are returned as JSON-RPC results with
    // isError: true), but a bug in the dispatcher or a credential
    // failure could land here. Log loudly so CloudWatch sees it.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[mcp-handler] dispatch threw', { method: req.method, message })
    return jsonResponse(
      500,
      jsonRpcError(req.id ?? null, JSON_RPC_INTERNAL_ERROR, message)
    )
  }
}
