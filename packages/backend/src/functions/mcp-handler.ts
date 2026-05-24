import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { createHash } from 'node:crypto'

import { dispatchToolCall, tools, type StorageClient, type ToolContext } from '@ampless/mcp-server/tools'
import { createMcpGraphqlClient } from './mcp-graphql-client.js'
import { createMcpStorageClient } from './mcp-storage-client.js'

/**
 * MCP HTTP endpoint Lambda. Bearer validation + JSON-RPC 2.0 tool
 * dispatch over AppSync IAM auth, including `upload_media`.
 *
 *   1. Reads the admin-only `McpToken` DynamoDB table directly
 *      (identifier = SHA-256 hex of plaintext) to validate
 *      `Authorization: Bearer amk_...`. The Lambda has a narrow IAM
 *      grant: `dynamodb:GetItem` on the McpToken table only — no
 *      AppSync round-trip for token validation.
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
 *  2. GetItem on the McpToken table at `{ hash }`.
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

async function dispatchJsonRpc(req: JsonRpcRequest): Promise<JsonRpcResponse> {
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
      const ctx = makeContext()
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
    const response = await dispatchJsonRpc(req)
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
