/**
 * Storage layer for MCP API access tokens, persisted in the
 * admin-only `McpToken` AppSync model (identifier = SHA-256 hex of
 * plaintext).
 *
 * The Lambda validator reads the same table directly via DynamoDB
 * GetItem (see `packages/backend/src/functions/mcp-handler.ts`) — the
 * admin UI write path goes through AppSync, so the `ampless-admin`
 * group restriction is enforced at the API layer.
 *
 * Revocation is a soft delete: `revokedAt` is set and the row stays
 * for audit. Callers validating an incoming Bearer must check
 * `revokedAt === null` AND `expiresAt` (if set) AND that the row exists.
 */

import { getMcpTokenStore, type McpTokenRow } from './mcp-token-store.js'

export type McpTokenMeta = McpTokenRow

export async function listTokens(): Promise<McpTokenMeta[]> {
  return await getMcpTokenStore().list()
}

export async function findByHash(hash: string): Promise<McpTokenMeta | null> {
  return await getMcpTokenStore().get(hash)
}

export async function createToken(
  meta: Omit<McpTokenMeta, 'lastUsedAt' | 'revokedAt'>
): Promise<McpTokenMeta> {
  const full: McpTokenMeta = {
    ...meta,
    lastUsedAt: null,
    revokedAt: null,
  }
  await getMcpTokenStore().put(full)
  return full
}

export async function revokeToken(hash: string): Promise<void> {
  const existing = await findByHash(hash)
  if (!existing) return
  if (existing.revokedAt) return
  await getMcpTokenStore().put({
    ...existing,
    revokedAt: new Date().toISOString(),
  })
}

export async function touchLastUsed(hash: string): Promise<void> {
  const existing = await findByHash(hash)
  if (!existing) return
  await getMcpTokenStore().put({
    ...existing,
    lastUsedAt: new Date().toISOString(),
  })
}
