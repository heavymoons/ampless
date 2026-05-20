/**
 * MCP token management API.
 *
 * Mounted at `/api/admin/mcp-tokens` (POST = create, DELETE = revoke).
 * Both endpoints require the calling admin's Cognito session to be in
 * the `ampless-admin` group — token issuance is sensitive and
 * `editor` is intentionally excluded.
 *
 * Token format (`amp_mcp_<base64url(32)>`) and storage layout live in
 * `lib/mcp-token-storage.ts`.
 */

import type { Admin } from '../index.js'
import {
  generateToken,
  hashToken,
  listTokens,
  revokeToken,
  saveToken,
  type McpTokenMeta,
  type McpTokenRole,
} from '../lib/mcp-token-storage.js'

interface CreateBody {
  label?: unknown
  role?: unknown
}

function isRole(value: unknown): value is McpTokenRole {
  return value === 'admin' || value === 'editor'
}

export function createMcpTokensRoute(admin: Admin) {
  async function requireAdminSession(): Promise<{ userId: string } | Response> {
    const session = await admin.getServerSession()
    if (!session || !admin.isAdmin(session)) {
      return json({ error: 'admin role required' }, 403)
    }
    return { userId: session.userId }
  }

  /**
   * List existing tokens. Returns metadata only (label / role /
   * createdAt / lastUsedAt / hash) — never plaintext.
   */
  async function GET(): Promise<Response> {
    const guard = await requireAdminSession()
    if (guard instanceof Response) return guard
    try {
      const tokens = await listTokens()
      return json({ tokens })
    } catch (err) {
      console.error('[mcp-tokens] list failed', err)
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  }

  /**
   * Generate a new token. Body: `{ label: string, role: 'admin' | 'editor' }`.
   * Response includes the plaintext under `token` exactly once — clients
   * must surface it immediately and never store it.
   */
  async function POST(req: Request): Promise<Response> {
    const guard = await requireAdminSession()
    if (guard instanceof Response) return guard
    let body: CreateBody
    try {
      body = (await req.json()) as CreateBody
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    const label =
      typeof body.label === 'string' ? body.label.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 80) : ''
    if (!label) {
      return json({ error: 'label is required' }, 400)
    }
    if (!isRole(body.role)) {
      return json({ error: 'role must be "admin" or "editor"' }, 400)
    }
    const { plaintext, hash } = generateToken()
    const meta: McpTokenMeta = {
      label,
      role: body.role,
      createdAt: new Date().toISOString(),
      createdBy: guard.userId,
    }
    try {
      await saveToken(hash, meta)
    } catch (err) {
      console.error('[mcp-tokens] save failed', err)
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
    return json({ token: plaintext, record: { hash, ...meta } }, 201)
  }

  /**
   * Revoke a token by its hash (sha256 hex, the sort key). Body:
   * `{ hash: string }`. Once revoked the plaintext stops authorizing
   * MCP requests immediately on the next KvStore read.
   */
  async function DELETE(req: Request): Promise<Response> {
    const guard = await requireAdminSession()
    if (guard instanceof Response) return guard
    let body: { hash?: unknown; token?: unknown }
    try {
      body = (await req.json()) as { hash?: unknown; token?: unknown }
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    let hash: string
    if (typeof body.hash === 'string' && body.hash.length === 64) {
      hash = body.hash
    } else if (typeof body.token === 'string') {
      hash = hashToken(body.token)
    } else {
      return json({ error: 'hash or token required' }, 400)
    }
    try {
      await revokeToken(hash)
    } catch (err) {
      console.error('[mcp-tokens] revoke failed', err)
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
    return json({ ok: true })
  }

  return { GET, POST, DELETE }
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
