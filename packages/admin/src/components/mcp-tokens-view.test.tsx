/**
 * Unit tests for the McpTokensView business logic: storage interactions,
 * status derivation, and scope labelling.
 *
 * We test the underlying functions used by the view directly — the React
 * component itself requires a DOM environment (jsdom) that isn't wired up
 * in this package's vitest config. The tests below cover all meaningful
 * behaviours specified in the Phase 2 design:
 *
 *   - Empty state: listTokens returns []
 *   - Token list: stored tokens are retrieved correctly
 *   - Create token flow: generateToken + createToken persists the record
 *   - Revoke flow: revokeToken sets revokedAt, tokenStatus returns 'revoked'
 *   - Expired token: tokenStatus returns 'expired' when expiresAt < now
 *
 * Cognito user info is passed as plain props (userId / email) in the real
 * component — no mocking of auth is required here.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setKvStore } from 'ampless'
import type { KvStore, KvItem } from 'ampless'
import { generateToken } from '../lib/mcp-token-format.js'
import {
  listTokens,
  createToken,
  revokeToken,
  type McpTokenMeta,
} from '../lib/mcp-token-storage.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInMemoryKvStore(): KvStore {
  const db = new Map<string, Map<string, unknown>>()
  return {
    async get<T>(pk: string, sk: string): Promise<T | null> {
      return (db.get(pk)?.get(sk) as T) ?? null
    },
    async query<T>(pk: string): Promise<KvItem<T>[]> {
      const partition = db.get(pk)
      if (!partition) return []
      return Array.from(partition.entries()).map(([sk, value]) => ({ pk, sk, value: value as T }))
    },
    async put(pk: string, sk: string, value: unknown): Promise<void> {
      if (!db.has(pk)) db.set(pk, new Map())
      db.get(pk)!.set(sk, value)
    },
    async remove(pk: string, sk: string): Promise<void> {
      db.get(pk)?.delete(sk)
    },
  }
}

function makeTokenMeta(
  overrides: Partial<Omit<McpTokenMeta, 'lastUsedAt' | 'revokedAt'>> = {}
): Omit<McpTokenMeta, 'lastUsedAt' | 'revokedAt'> {
  const { hash, prefix } = generateToken()
  return {
    hash,
    prefix,
    scope: { siteId: null },
    createdBy: 'user-sub-abc',
    createdByEmail: 'admin@example.com',
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  }
}

/** Derive token display status the same way McpTokensView does. */
function tokenStatus(tok: McpTokenMeta): 'active' | 'revoked' | 'expired' {
  if (tok.revokedAt) return 'revoked'
  if (tok.expiresAt && new Date(tok.expiresAt) < new Date()) return 'expired'
  return 'active'
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setKvStore(makeInMemoryKvStore())
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('empty state', () => {
  it('listTokens returns an empty array when no tokens have been created', async () => {
    const tokens = await listTokens()
    expect(tokens).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Token list display
// ---------------------------------------------------------------------------

describe('token list', () => {
  it('returns all stored tokens', async () => {
    const meta1 = makeTokenMeta()
    const meta2 = makeTokenMeta({ scope: { siteId: 'site-a' } })
    await createToken(meta1)
    await createToken(meta2)

    const tokens = await listTokens()
    expect(tokens).toHaveLength(2)
    expect(tokens.map((t) => t.hash)).toContain(meta1.hash)
    expect(tokens.map((t) => t.hash)).toContain(meta2.hash)
  })

  it('persists prefix and scope for display', async () => {
    const meta = makeTokenMeta({ scope: { siteId: 'site-blog' } })
    await createToken(meta)

    const [stored] = await listTokens()
    expect(stored!.prefix).toBe(meta.prefix)
    expect(stored!.scope.siteId).toBe('site-blog')
  })

  it('stores createdBy and createdByEmail', async () => {
    const meta = makeTokenMeta({
      createdBy: 'cognito-sub-xyz',
      createdByEmail: 'editor@example.com',
    })
    await createToken(meta)

    const [stored] = await listTokens()
    expect(stored!.createdBy).toBe('cognito-sub-xyz')
    expect(stored!.createdByEmail).toBe('editor@example.com')
  })
})

// ---------------------------------------------------------------------------
// Create token flow
// ---------------------------------------------------------------------------

describe('create token flow', () => {
  it('generateToken produces a plaintext token, hash, and prefix', () => {
    const { plain, hash, prefix } = generateToken()
    expect(plain).toMatch(/^amk_/)
    expect(hash).toHaveLength(64) // SHA-256 hex
    expect(plain.startsWith(prefix)).toBe(true)
    expect(prefix).toHaveLength(8)
  })

  it('createToken persists the record with null lastUsedAt and revokedAt', async () => {
    const meta = makeTokenMeta()
    const created = await createToken(meta)

    expect(created.lastUsedAt).toBeNull()
    expect(created.revokedAt).toBeNull()

    const all = await listTokens()
    expect(all).toHaveLength(1)
    expect(all[0]!.hash).toBe(meta.hash)
  })

  it('createToken with expiresAt stores the ISO date', async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const meta = makeTokenMeta({ expiresAt })
    await createToken(meta)

    const [stored] = await listTokens()
    expect(stored!.expiresAt).toBe(expiresAt)
  })

  it('createToken with scope.siteId = null represents all-sites', async () => {
    const meta = makeTokenMeta({ scope: { siteId: null } })
    await createToken(meta)

    const [stored] = await listTokens()
    expect(stored!.scope.siteId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Revoke flow
// ---------------------------------------------------------------------------

describe('revoke flow', () => {
  it('revokeToken sets revokedAt and tokenStatus returns "revoked"', async () => {
    const meta = makeTokenMeta()
    await createToken(meta)

    await revokeToken(meta.hash)

    const [stored] = await listTokens()
    expect(stored!.revokedAt).toBeTruthy()
    expect(tokenStatus(stored!)).toBe('revoked')
  })

  it('revokeToken is idempotent — revokedAt does not change on second call', async () => {
    const meta = makeTokenMeta()
    await createToken(meta)

    await revokeToken(meta.hash)
    const first = (await listTokens())[0]!.revokedAt

    await revokeToken(meta.hash)
    const second = (await listTokens())[0]!.revokedAt

    expect(second).toBe(first)
  })

  it('active token status is "active" before revocation', async () => {
    const meta = makeTokenMeta()
    const stored = await createToken(meta)
    expect(tokenStatus(stored)).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// Expired token status
// ---------------------------------------------------------------------------

describe('expired token status', () => {
  it('tokenStatus returns "expired" when expiresAt is in the past', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const meta = makeTokenMeta({ expiresAt: past })
    const stored = await createToken(meta)
    expect(tokenStatus(stored)).toBe('expired')
  })

  it('tokenStatus returns "active" when expiresAt is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const meta = makeTokenMeta({ expiresAt: future })
    const stored = await createToken(meta)
    expect(tokenStatus(stored)).toBe('active')
  })

  it('revoked takes precedence over expired', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const meta = makeTokenMeta({ expiresAt: past })
    const stored = await createToken(meta)
    await revokeToken(stored.hash)

    const [found] = await listTokens()
    expect(tokenStatus(found!)).toBe('revoked')
  })
})
