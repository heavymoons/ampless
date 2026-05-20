/**
 * KvStore-backed storage for MCP access tokens.
 *
 * Layout
 *  - PK: `mcp-tokens`
 *  - SK: `sha256(plaintext)` (hex)
 *  - Value: `{ label, role, createdAt, createdBy, lastUsedAt? }`
 *
 * Plaintext tokens are never persisted — we only keep the hash, and
 * surface the plaintext exactly once at issuance time so the admin
 * can copy it into their MCP client config.
 *
 * Tokens have the format `amp_mcp_<base64url(32 bytes)>` (~43 chars,
 * easy to grep for in logs and recognise in config files).
 */

import { createHash, randomBytes } from 'node:crypto'
import { getKvStore, type KvItem } from 'ampless'

const TOKENS_PK = 'mcp-tokens'

export type McpTokenRole = 'admin' | 'editor'

export interface McpTokenMeta {
  /** Human-readable label set at issue time (e.g. "Claude Desktop — laptop"). */
  label: string
  role: McpTokenRole
  /** ISO 8601 timestamp the token was issued. */
  createdAt: string
  /** Cognito `userId` of the admin who issued the token. */
  createdBy: string
  /** ISO 8601 timestamp of the most recent successful use (`undefined` until first use). */
  lastUsedAt?: string
}

export interface McpTokenRecord extends McpTokenMeta {
  /** The SK — sha256 hex of the plaintext token. */
  hash: string
}

/**
 * Generate a fresh, cryptographically-random MCP token.
 * Returns the plaintext (`amp_mcp_…`) and the hex sha256 hash.
 */
export function generateToken(): { plaintext: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  const plaintext = `amp_mcp_${raw}`
  const hash = hashToken(plaintext)
  return { plaintext, hash }
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export async function listTokens(): Promise<McpTokenRecord[]> {
  const items = (await getKvStore().query<McpTokenMeta>(TOKENS_PK)) as KvItem<McpTokenMeta>[]
  return items.map((it) => ({ hash: it.sk, ...it.value })).sort((a, b) => {
    // Newest first
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export async function saveToken(hash: string, meta: McpTokenMeta): Promise<void> {
  await getKvStore().put(TOKENS_PK, hash, meta)
}

export async function lookupToken(plaintext: string): Promise<McpTokenRecord | null> {
  const hash = hashToken(plaintext)
  const meta = await getKvStore().get<McpTokenMeta>(TOKENS_PK, hash)
  if (!meta) return null
  return { hash, ...meta }
}

export async function revokeToken(hash: string): Promise<void> {
  await getKvStore().remove(TOKENS_PK, hash)
}

/**
 * Bump `lastUsedAt`. Best-effort — failures are swallowed so a Kv
 * write outage never blocks a tool call that otherwise succeeded.
 */
export async function markTokenUsed(hash: string): Promise<void> {
  try {
    const meta = await getKvStore().get<McpTokenMeta>(TOKENS_PK, hash)
    if (!meta) return
    await getKvStore().put(TOKENS_PK, hash, {
      ...meta,
      lastUsedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[mcp-token-storage] markTokenUsed failed', err)
  }
}
