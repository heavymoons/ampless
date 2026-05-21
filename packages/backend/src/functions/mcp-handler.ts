import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { createHash } from 'node:crypto'

/**
 * MCP HTTP endpoint Lambda. Phase 3: Bearer token validation only.
 *
 * Reads the KvStore table directly (PK = 'mcp-tokens', SK = SHA-256
 * hash of the plaintext token) instead of going through AppSync — the
 * Lambda IAM role only needs `dynamodb:GetItem` on that one table,
 * which is much narrower than `appsync:GraphQL` and avoids the
 * IAM-auth-mode complexity of letting Lambdas call AppSync as
 * privileged identity. Phase 4 will add AppSync IAM auth when tool
 * dispatch actually needs schema-aware access.
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

interface KvRow {
  pk: string
  sk: string
  value: string // JSON-encoded McpTokenMeta
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

const TOKENS_PK = 'mcp-tokens'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[mcp-handler] missing required env var ${name}`)
  return v
}

const KV_TABLE = requireEnv('AMPLESS_KV_TABLE')
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

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
  let meta: McpTokenMeta
  try {
    meta = JSON.parse(row.value) as McpTokenMeta
  } catch {
    console.error('[mcp-handler] could not parse token row', { hash })
    return null
  }
  if (meta.revokedAt) return null
  if (meta.expiresAt && new Date(meta.expiresAt).getTime() <= Date.now()) return null
  return meta
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

  // Phase 3 stub. Phase 4 will dispatch the actual MCP JSON-RPC call.
  return jsonResponse(200, {
    ok: true,
    tokenPrefix: meta.prefix,
    scope: meta.scope,
    note: 'Phase 3 stub. JSON-RPC tool dispatch lands in Phase 4.',
  })
}
