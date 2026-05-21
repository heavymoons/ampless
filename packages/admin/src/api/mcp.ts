/**
 * HTTP MCP transport.
 *
 * Mounts at `/api/mcp` on the user's site. Speaks the MCP JSON-RPC
 * protocol over POST (no SSE streaming — single request/response per
 * tool call, which is what every MCP client uses for `tools/call`).
 *
 * Auth: `Authorization: Bearer amp_mcp_<...>`. The Bearer token is
 * hashed (sha256) and looked up in KvStore (`mcp-tokens` PK). On
 * match the route runs the tool with a `ToolContext` backed by:
 *   - The Cognito service user's id token (server-side cached)
 *   - The site's AppSync endpoint
 *
 * Per-token role enforcement happens before tool dispatch — an
 * `editor`-scoped token can't reach admin-only mutations even though
 * the underlying Cognito identity could.
 *
 * `upload_media` is intentionally NOT supported over HTTP in v0.x:
 * the SSR Lambda's execution role doesn't have direct S3 PUT
 * permission, and granting it across Amplify Hosting's managed
 * compute model requires extra setup we punt to v0.y. The other six
 * tools (read + write Post / read schema) cover most automation.
 */

import {
  dispatchToolCall,
  getTools,
  type ToolContext,
  type GraphqlClient,
  type StorageClient,
} from '@ampless/mcp-server/tools'
import type { Admin } from '../index.js'
import { getMcpServiceAuth } from '../lib/mcp-service-auth.js'
import { installServerKvProvider } from '../lib/kv-provider-server.js'
import {
  hashToken,
  markTokenUsed,
  type McpTokenRecord,
  type McpTokenRole,
} from '../lib/mcp-token-storage.js'
import { getKvStore } from 'ampless'

// Token plaintext starts with this prefix; reject mismatches before
// hashing so an obvious garbage value fails fast.
const TOKEN_PREFIX = 'amp_mcp_'

// `upload_media` is rejected at dispatch time — the SSR Lambda
// doesn't have direct S3 PUT permission and we don't want to silently
// fall over. Users upload via the admin UI for now.
const UNSUPPORTED_OVER_HTTP = new Set(['upload_media'])

// Tools that require `admin` role. Everything else accepts `editor`.
const ADMIN_ONLY_TOOLS = new Set(['delete_post'])

export function createMcpRoute(admin: Admin) {
  const { outputs, cmsConfig } = admin
  const defaultSiteId = (cmsConfig as { defaultSiteId?: string }).defaultSiteId ?? 'default'
  // `outputs.data` is optional in the schema — sites that deploy
  // without an AppSync API can't host MCP. Fail at factory time
  // instead of at first request so the misconfig is obvious.
  if (!outputs.data?.url) {
    throw new Error(
      '[mcp] createMcpRoute requires amplify_outputs.json with a `data.url` (AppSync endpoint).'
    )
  }
  const appsyncUrl = outputs.data.url
  const serviceAuth = getMcpServiceAuth(outputs)
  // Make `getKvStore()` resolvable on the server side. The client-side
  // `installAdminKvProvider` only runs in browsers, so without this the
  // first MCP request errors out at token lookup.
  installServerKvProvider(outputs)

  // Build a GraphqlClient adapter on demand (per request). It re-uses
  // the cached service id token, so the per-request cost is just a
  // pointer dereference plus the eventual `fetch`.
  function makeGraphqlClient(): GraphqlClient {
    return {
      async query<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
        const idToken = await serviceAuth.getIdToken()
        const res = await fetch(appsyncUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // AppSync userPool auth: bare id token, no "Bearer" prefix.
            Authorization: idToken,
          },
          body: JSON.stringify({ query: operation, variables: variables ?? {} }),
        })
        const json = (await res.json()) as {
          data?: T
          errors?: Array<{ message: string }>
        }
        if (json.errors && json.errors.length > 0) {
          throw new Error(`[mcp] AppSync error: ${json.errors[0]!.message}`)
        }
        if (json.data === undefined) {
          throw new Error('[mcp] AppSync response had no `data` field')
        }
        return json.data
      },
    }
  }

  // Throwing StorageClient — `upload_media` is rejected before dispatch,
  // but if a future tool calls `storage()` we want a clear error.
  function unsupportedStorage(): StorageClient {
    return {
      async putObject() {
        throw new Error(
          '[mcp] upload_media is not supported over HTTP in v0.x. Upload via the admin UI instead.'
        )
      },
    }
  }

  async function POST(req: Request): Promise<Response> {
    // 1. Bearer token validation.
    const auth = req.headers.get('authorization') ?? ''
    const plaintext = /^Bearer\s+(.+)$/.exec(auth.trim())?.[1]?.trim()
    if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) {
      logMcp({ event: 'mcp.auth_failed', reason: 'missing-or-malformed-bearer' })
      return jsonRpcError(null, -32000, 'unauthorized', 401)
    }
    let tokenRecord: McpTokenRecord | null = null
    let tokenHash: string | undefined
    try {
      tokenHash = hashToken(plaintext)
      const meta = await getKvStore().get<Omit<McpTokenRecord, 'hash'>>('mcp-tokens', tokenHash)
      if (meta) tokenRecord = { hash: tokenHash, ...meta } as McpTokenRecord
    } catch (err) {
      console.error('[mcp] token lookup failed', err)
      return jsonRpcError(null, -32000, 'token lookup failed', 500)
    }
    if (!tokenRecord) {
      // Log the (short) hash of the offending token so attempts using
      // a revoked or never-issued key are auditable. Plaintext is
      // never logged.
      logMcp({
        event: 'mcp.auth_failed',
        reason: 'token-not-found',
        tokenHashPrefix: tokenHash ? tokenHash.slice(0, 12) : undefined,
      })
      return jsonRpcError(null, -32000, 'unauthorized', 401)
    }

    // 2. Parse JSON-RPC envelope.
    let body: { jsonrpc?: string; method?: string; params?: unknown; id?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return jsonRpcError(null, -32700, 'parse error', 400)
    }
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return jsonRpcError(body.id ?? null, -32600, 'invalid request', 400)
    }

    const reqId = (body.id as string | number | null | undefined) ?? null

    // 3. Dispatch by JSON-RPC method.
    try {
      switch (body.method) {
        case 'initialize': {
          // Minimal initialize response. We declare capability for
          // tools/* methods only — no prompts, no resources.
          return jsonRpcOk(reqId, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'ampless-mcp', version: '0.2.0-alpha' },
          })
        }
        case 'notifications/initialized':
        case 'notifications/cancelled': {
          // Notifications carry no id and expect no response body.
          return new Response(null, { status: 204 })
        }
        case 'tools/list': {
          const tools = getTools().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }))
          return jsonRpcOk(reqId, { tools })
        }
        case 'tools/call': {
          const params = (body.params ?? {}) as {
            name?: string
            arguments?: Record<string, unknown>
          }
          const name = params.name
          if (!name || typeof name !== 'string') {
            return jsonRpcError(reqId, -32602, 'missing tool name', 400)
          }
          // Per-token / per-tool structured log. We deliberately
          // record only argument KEYS (not values) — arguments may
          // contain post bodies, PII, or other sensitive payloads
          // that don't belong in CloudWatch indefinitely.
          const tokenContext = {
            tokenHashPrefix: tokenRecord.hash.slice(0, 12),
            tokenLabel: tokenRecord.label,
            tokenRole: tokenRecord.role,
          }
          const startedAt = Date.now()
          logMcp({
            event: 'mcp.tool_call',
            ...tokenContext,
            tool: name,
            argKeys: Object.keys(params.arguments ?? {}),
          })
          if (UNSUPPORTED_OVER_HTTP.has(name)) {
            logMcp({ event: 'mcp.tool_unsupported', ...tokenContext, tool: name })
            return jsonRpcError(
              reqId,
              -32001,
              `${name} is not supported over HTTP — use the admin UI`,
              200
            )
          }
          if (ADMIN_ONLY_TOOLS.has(name) && tokenRecord.role !== 'admin') {
            logMcp({ event: 'mcp.role_denied', ...tokenContext, tool: name })
            return jsonRpcError(reqId, -32003, `${name} requires admin role`, 403)
          }
          const ctx: ToolContext = {
            graphql: makeGraphqlClient(),
            storage: unsupportedStorage,
            defaultSiteId,
          }
          try {
            const result = await dispatchToolCall(name, params.arguments ?? {}, ctx)
            if (result === null) {
              logMcp({
                event: 'mcp.tool_unknown',
                ...tokenContext,
                tool: name,
                durationMs: Date.now() - startedAt,
              })
              return jsonRpcError(reqId, -32601, `unknown tool: ${name}`, 404)
            }
            logMcp({
              event: 'mcp.tool_ok',
              ...tokenContext,
              tool: name,
              durationMs: Date.now() - startedAt,
            })
            // Best-effort lastUsedAt update — fire and forget so the
            // tool response isn't delayed by the Kv write.
            void markTokenUsed(tokenRecord.hash)
            return jsonRpcOk(reqId, {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            })
          } catch (err) {
            logMcp({
              event: 'mcp.tool_failed',
              ...tokenContext,
              tool: name,
              durationMs: Date.now() - startedAt,
              error: err instanceof Error ? err.message : String(err),
            })
            throw err
          }
        }
        default:
          return jsonRpcError(reqId, -32601, `method not found: ${body.method}`, 404)
      }
    } catch (err) {
      console.error('[mcp] tool dispatch failed', err)
      const message = err instanceof Error ? err.message : String(err)
      return jsonRpcError(reqId, -32000, message, 500)
    }
  }

  return { POST }
}

function jsonRpcOk(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Emit a single-line JSON log so CloudWatch Logs Insights can index
 * MCP traffic by token / tool / outcome. AppSync and S3 audit logs
 * show every MCP-driven call as the shared service user — this
 * structured Lambda log is the only place per-token attribution
 * survives.
 *
 * Fields ampless callers reliably emit:
 *   - `event` — one of `mcp.auth_failed | mcp.tool_call | mcp.tool_ok |
 *     mcp.tool_failed | mcp.tool_unsupported | mcp.role_denied |
 *     mcp.tool_unknown`
 *   - `tokenHashPrefix` (12 hex chars) — short hash identifier; safe
 *     to share / search in logs. Plaintext tokens are NEVER logged.
 *   - `tokenLabel`, `tokenRole`
 *   - `tool`, `argKeys`, `durationMs`, `error` (when applicable)
 *
 * Insights example:
 *   fields @timestamp, event, tokenLabel, tool, durationMs
 *   | filter event like /mcp\\./
 *   | sort @timestamp desc
 */
function logMcp(record: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...record, ts: new Date().toISOString() }))
}

function jsonRpcError(id: unknown, code: number, message: string, status: number): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Re-export role type for convenience to consumers that import from
// `@ampless/admin/api`.
export type { McpTokenRole }
