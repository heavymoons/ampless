import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { createHash } from 'node:crypto'

import { decodeAwsJson } from 'ampless'
import { dispatchToolCall, tools, type ToolContext } from '@ampless/mcp-server/tools'
import { createMcpGraphqlClient } from './mcp-graphql-client.js'

/**
 * MCP HTTP endpoint Lambda. Phase 4: Bearer validation + JSON-RPC 2.0
 * tool dispatch over AppSync IAM auth.
 *
 *   1. Reads KvStore directly (PK = 'mcp-tokens', SK = SHA-256 hex)
 *      to validate `Authorization: Bearer amk_...`. Same narrow IAM
 *      grant as Phase 3 (`dynamodb:GetItem` on the KvStore table).
 *   2. Parses the incoming JSON-RPC envelope by hand (no MCP SDK
 *      stdio transport in a Lambda runtime — overkill for the three
 *      verbs we actually need).
 *   3. Dispatches `tools/call` through the shared `@ampless/mcp-server/tools`
 *      registry. The GraphqlClient implementation hits AppSync with
 *      SigV4 (`AWS_IAM` auth mode), gated by `allow.resource(mcpHandler)
 *      .to(['query', 'mutate'])` on Post / PostTag in the schema.
 *
 * Function URL event format: Lambda Function URLs emit API Gateway
 * HTTP v2 events (https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html#urls-payloads).
 * Headers arrive lowercased.
 *
 * Note: `upload_media` is filtered out — the StorageClient flow needs
 * presigned S3 PUT URLs (the Lambda doesn't accept the binary body
 * itself), which lands in Phase 5.
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

interface KvRow {
  pk: string
  sk: string
  /**
   * Stored as an `a.json()` field. Two shapes show up at this layer:
   *   - JSON-encoded string: what the admin client serialises into
   *     AppSync's AWSJSON input ("a JSON-encoded string"), preserved
   *     verbatim by some resolver paths.
   *   - Native object: Amplify Gen 2's auto-generated CreateKvStore /
   *     UpdateKvStore resolver parses the incoming AWSJSON and stores
   *     it as a native DynamoDB Map. `DynamoDBDocumentClient` then
   *     unmarshals it straight into a JS object on read.
   * Handle both — the existing trusted-processor cache code does the
   * same dance for `siteconfig:*` rows.
   */
  value: string | Record<string, unknown>
  ttl?: number | null
}

interface McpTokenMeta {
  hash: string
  prefix: string
  scope: { siteId: string | null }
  createdBy: string
  createdByEmail: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const TOKENS_PK = 'mcp-tokens'

// Standard JSON-RPC 2.0 error codes
// https://www.jsonrpc.org/specification#error_object
const JSON_RPC_PARSE_ERROR = -32700
const JSON_RPC_INVALID_REQUEST = -32600
const JSON_RPC_METHOD_NOT_FOUND = -32601
const JSON_RPC_INVALID_PARAMS = -32602
const JSON_RPC_INTERNAL_ERROR = -32603

// Protocol version we advertise on `initialize`. Picked from
// SUPPORTED_PROTOCOL_VERSIONS in @modelcontextprotocol/sdk — sticking
// to a stable older value (2024-11-05) keeps the surface small and
// avoids tracking spec churn until a tool actually needs a newer
// capability.
const MCP_PROTOCOL_VERSION = '2024-11-05'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[mcp-handler] missing required env var ${name}`)
  return v
}

const KV_TABLE = requireEnv('AMPLESS_KV_TABLE')
const APPSYNC_URL = requireEnv('AMPLESS_APPSYNC_URL')
const AWS_REGION = process.env['AWS_REGION'] ?? 'us-east-1'
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// HTTP transport doesn't carry the binary body for `upload_media` —
// that needs the presigned-PUT flow planned for Phase 5. Drop it from
// the advertised registry so MCP clients don't see a verb they can't call.
const HTTP_TOOLS = tools.filter((t) => t.name !== 'upload_media')

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

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: JsonRpcResponse['error'] = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

/**
 * Validate a Bearer token by:
 *  1. Hashing the plaintext to its SHA-256 hex.
 *  2. Looking up the KvStore row at (PK = 'mcp-tokens', SK = hash).
 *  3. Rejecting if missing, revoked, or expired.
 * Returns the decoded meta on success, or `null` on any failure (caller
 * surfaces the same 401 either way — exposing which check failed would
 * leak whether a hash exists in storage).
 */
async function validateBearer(plaintext: string): Promise<McpTokenMeta | null> {
  const hash = hashToken(plaintext)
  const res = await ddb.send(
    new GetCommand({
      TableName: KV_TABLE,
      Key: { pk: TOKENS_PK, sk: hash },
    })
  )
  const row = res.Item as KvRow | undefined
  if (!row?.value) return null
  const meta = decodeTokenMeta(row.value)
  if (!meta) {
    console.error('[mcp-handler] could not decode token row', { hash, valueType: typeof row.value })
    return null
  }
  if (meta.revokedAt) return null
  if (meta.expiresAt && new Date(meta.expiresAt).getTime() <= Date.now()) return null
  return meta
}

/**
 * `value` arrives in either of two shapes (see `KvRow.value` comment).
 * Defer the wire-shape handling to the shared `decodeAwsJson` and
 * narrow the result to `McpTokenMeta`, returning `null` if the shape
 * is unrecognisable — leak nothing about which check failed.
 */
function decodeTokenMeta(value: KvRow['value']): McpTokenMeta | null {
  const parsed = decodeAwsJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as unknown as McpTokenMeta
}

// Lazy graphql client: instantiated on first tools/call request so
// `initialize` / `tools/list` (which never touch AppSync) don't pay
// the credential-chain lookup. Cached for the warm-Lambda lifetime.
let cachedCtx: ToolContext | null = null
function makeContext(meta: McpTokenMeta): ToolContext {
  if (cachedCtx && cachedCtx.defaultSiteId === (meta.scope.siteId ?? 'default')) {
    return cachedCtx
  }
  const ctx: ToolContext = {
    graphql: createMcpGraphqlClient({ endpoint: APPSYNC_URL, region: AWS_REGION }),
    storage: () => {
      throw new Error(
        'upload_media is not available on the HTTP MCP transport in v0.2 Phase 4 — use the stdio CLI or wait for Phase 5'
      )
    },
    defaultSiteId: meta.scope.siteId ?? 'default',
  }
  cachedCtx = ctx
  return ctx
}

async function dispatchJsonRpc(
  req: JsonRpcRequest,
  meta: McpTokenMeta
): Promise<JsonRpcResponse> {
  switch (req.method) {
    case 'initialize':
      return jsonRpcResult(req.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ampless-mcp', version: '0.2' },
      })

    case 'notifications/initialized':
      // MCP clients fire this after `initialize` succeeds. It's a
      // one-way notification; spec says respond with no result.
      return jsonRpcResult(req.id, null)

    case 'tools/list':
      return jsonRpcResult(req.id, {
        tools: HTTP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case 'tools/call': {
      const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined
      if (!params?.name || typeof params.name !== 'string') {
        return jsonRpcError(req.id, JSON_RPC_INVALID_PARAMS, 'tools/call requires a `name` parameter')
      }
      const tool = HTTP_TOOLS.find((t) => t.name === params.name)
      if (!tool) {
        return jsonRpcError(req.id, JSON_RPC_METHOD_NOT_FOUND, `unknown tool: ${params.name}`)
      }
      const ctx = makeContext(meta)
      try {
        const result = await dispatchToolCall(params.name, params.arguments ?? {}, ctx)
        // Match the stdio server's response shape: { content: [{ type: 'text', text: ... }] }.
        return jsonRpcResult(req.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        })
      } catch (err) {
        // Tool errors are reported via isError + content (per MCP),
        // not as JSON-RPC errors. The stdio server uses the same shape.
        const message = err instanceof Error ? err.message : String(err)
        console.error('[mcp-handler] tool dispatch failed', {
          tool: params.name,
          message,
        })
        return jsonRpcResult(req.id, {
          isError: true,
          content: [{ type: 'text', text: message }],
        })
      }
    }

    default:
      return jsonRpcError(req.id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`)
  }
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
    const response = await dispatchJsonRpc(req, meta)
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
