import { describe, it, expect, beforeEach } from 'vitest'
import { generateToken, hashToken } from './mcp-token-format.js'
import {
  listTokens,
  findByHash,
  createToken,
  revokeToken,
  touchLastUsed,
} from './mcp-token-storage.js'
import type { McpTokenMeta } from './mcp-token-storage.js'
import { setMcpTokenStore, type McpTokenRow, type McpTokenStore } from './mcp-token-store.js'

function makeInMemoryStore(): McpTokenStore {
  const db = new Map<string, McpTokenRow>()
  return {
    async list() {
      return Array.from(db.values())
    },
    async get(hash) {
      return db.get(hash) ?? null
    },
    async put(row) {
      db.set(row.hash, row)
    },
    async remove(hash) {
      db.delete(hash)
    },
  }
}

function makeMeta(overrides: Partial<McpTokenMeta> = {}): Omit<McpTokenMeta, 'lastUsedAt' | 'revokedAt'> {
  const { hash, prefix } = generateToken()
  return {
    hash,
    prefix,
    createdBy: 'user-sub-123',
    createdByEmail: 'admin@example.com',
    issuedAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  setMcpTokenStore(makeInMemoryStore())
})

describe('generateToken', () => {
  it('produces an amk_ prefixed token', () => {
    const { plain } = generateToken()
    expect(plain).toMatch(/^amk_/)
  })

  it('produces unique tokens across multiple calls', () => {
    const tokens = Array.from({ length: 10 }, () => generateToken().plain)
    const unique = new Set(tokens)
    expect(unique.size).toBe(10)
  })

  it('produces URL-safe characters only — guards against base64url polyfill regression', () => {
    // The browser admin UI runs this on Next.js's `node:crypto` polyfill,
    // which throws on `Buffer.toString('base64url')` but accepts plain
    // `base64`. The format helper translates base64 → URL-safe by hand;
    // this test ensures none of `+`, `/`, or `=` slip through into a
    // shareable token (which would also break URL embedding / .env files).
    for (let i = 0; i < 50; i++) {
      const { plain } = generateToken()
      expect(plain).toMatch(/^amk_[A-Za-z0-9_-]+$/)
    }
  })

  it('hash is deterministic for the same input', () => {
    const a = hashToken('amk_test')
    const b = hashToken('amk_test')
    expect(a).toBe(b)
  })

  it('generateToken().hash matches hashToken(generateToken().plain) for the same token', () => {
    const token = generateToken()
    expect(token.hash).toBe(hashToken(token.plain))
  })

  it('prefix is the first 8 characters of the plaintext', () => {
    const token = generateToken()
    expect(token.prefix).toBe(token.plain.slice(0, 8))
    expect(token.prefix).toHaveLength(8)
  })
})

describe('createToken / findByHash', () => {
  it('stores and retrieves a token with null lastUsedAt and revokedAt', async () => {
    const meta = makeMeta()
    const created = await createToken(meta)

    expect(created.lastUsedAt).toBeNull()
    expect(created.revokedAt).toBeNull()

    const found = await findByHash(meta.hash)
    expect(found).toEqual(created)
  })

  it('returns null for an unknown hash', async () => {
    const result = await findByHash('0000000000000000000000000000000000000000000000000000000000000000')
    expect(result).toBeNull()
  })
})

describe('listTokens', () => {
  it('returns all stored tokens', async () => {
    const meta1 = makeMeta()
    const meta2 = makeMeta()
    await createToken(meta1)
    await createToken(meta2)

    const tokens = await listTokens()
    expect(tokens).toHaveLength(2)
    const hashes = tokens.map((t) => t.hash)
    expect(hashes).toContain(meta1.hash)
    expect(hashes).toContain(meta2.hash)
  })

  it('returns an empty array when no tokens exist', async () => {
    const tokens = await listTokens()
    expect(tokens).toEqual([])
  })
})

describe('revokeToken', () => {
  it('sets revokedAt to an ISO string', async () => {
    const meta = makeMeta()
    await createToken(meta)

    await revokeToken(meta.hash)

    const found = await findByHash(meta.hash)
    expect(found!.revokedAt).toBeTruthy()
    expect(() => new Date(found!.revokedAt!)).not.toThrow()
  })

  it('is a no-op for an unknown hash', async () => {
    await expect(
      revokeToken('0000000000000000000000000000000000000000000000000000000000000000')
    ).resolves.toBeUndefined()
  })

  it('does not change revokedAt on a second call', async () => {
    const meta = makeMeta()
    await createToken(meta)

    await revokeToken(meta.hash)
    const first = (await findByHash(meta.hash))!.revokedAt

    await revokeToken(meta.hash)
    const second = (await findByHash(meta.hash))!.revokedAt

    expect(second).toBe(first)
  })
})

describe('touchLastUsed', () => {
  it('updates lastUsedAt', async () => {
    const meta = makeMeta()
    await createToken(meta)

    await touchLastUsed(meta.hash)

    const found = await findByHash(meta.hash)
    expect(found!.lastUsedAt).toBeTruthy()
    expect(() => new Date(found!.lastUsedAt!)).not.toThrow()
  })

  it('is a no-op for an unknown hash', async () => {
    await expect(
      touchLastUsed('0000000000000000000000000000000000000000000000000000000000000000')
    ).resolves.toBeUndefined()
  })
})
