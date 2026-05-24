/**
 * Storage layer for MCP API access tokens, persisted in the project's
 * KvStore (PK = `mcp-tokens`, SK = token SHA-256 hash).
 *
 * Storage-agnostic: callers install a `KvStore` implementation via
 * `setKvStore()` from `ampless` before invoking these functions. The
 * Lambda data path uses an implementation that talks to AppSync over
 * IAM; the admin UI path reuses the same library through whatever auth
 * context the route handler is in.
 *
 * Revocation is a soft delete: `revokedAt` is set and the row stays
 * for audit. Callers validating an incoming Bearer must check
 * `revokedAt === null` AND `expiresAt` (if set) AND that the row exists.
 */

import { getKvStore } from 'ampless'

const TOKENS_PK = 'mcp-tokens'

export interface McpTokenMeta {
  /** SHA-256 hex of the plaintext token (= storage SK). */
  hash: string
  /** Plaintext prefix for UI display, e.g. "amk_AbCd". */
  prefix: string
  /** Cognito `sub` of the admin who issued the token. */
  createdBy: string
  createdByEmail: string
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601 or null. Updated by the validator on each successful auth. */
  lastUsedAt: string | null
  /** ISO 8601 or null. Token rejected after this point. */
  expiresAt: string | null
  /** ISO 8601 or null. Token rejected once set. */
  revokedAt: string | null
}

export async function listTokens(): Promise<McpTokenMeta[]> {
  const items = await getKvStore().query<McpTokenMeta>(TOKENS_PK)
  return items.map((item) => item.value)
}

export async function findByHash(hash: string): Promise<McpTokenMeta | null> {
  return await getKvStore().get<McpTokenMeta>(TOKENS_PK, hash)
}

export async function createToken(
  meta: Omit<McpTokenMeta, 'lastUsedAt' | 'revokedAt'>
): Promise<McpTokenMeta> {
  const full: McpTokenMeta = {
    ...meta,
    lastUsedAt: null,
    revokedAt: null,
  }
  await getKvStore().put(TOKENS_PK, meta.hash, full)
  return full
}

export async function revokeToken(hash: string): Promise<void> {
  const existing = await findByHash(hash)
  if (!existing) return
  if (existing.revokedAt) return
  await getKvStore().put(TOKENS_PK, hash, {
    ...existing,
    revokedAt: new Date().toISOString(),
  })
}

export async function touchLastUsed(hash: string): Promise<void> {
  const existing = await findByHash(hash)
  if (!existing) return
  await getKvStore().put(TOKENS_PK, hash, {
    ...existing,
    lastUsedAt: new Date().toISOString(),
  })
}
