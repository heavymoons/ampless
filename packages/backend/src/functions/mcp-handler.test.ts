import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Set env before importing handler (top-level requireEnv throws otherwise).
process.env['AMPLESS_KV_TABLE'] = 'KvStore-test'

// Mock the DynamoDB Document client so tests never hit real AWS.
const mockSend = vi.fn()
vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({ send: mockSend }),
    },
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    GetCommand: class {
      input: unknown
      constructor(input: unknown) {
        this.input = input
      }
    },
  }
})
vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    DynamoDBClient: class {
      constructor() {}
    },
  }
})

// Dynamic import so the module-level DDB client construction picks up
// the mocks registered above.
const { handler } = await import('./mcp-handler.js')

// --- helpers ---

function makeEvent(opts: {
  method?: string
  authorization?: string
}): Parameters<typeof handler>[0] {
  return {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    requestContext: { http: { method: opts.method ?? 'POST' } },
  }
}

function makeValidTokenMeta(overrides: Record<string, unknown> = {}) {
  return {
    hash: 'abc123',
    prefix: 'amk_AbCd',
    scope: { siteId: null },
    createdBy: 'sub-1',
    createdByEmail: 'admin@example.com',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

// --- tests ---

describe('mcp-handler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it('OPTIONS preflight returns 204', async () => {
    const res = await handler(makeEvent({ method: 'OPTIONS' }))
    expect(res.statusCode).toBe(204)
  })

  it('missing Authorization header returns 401 missing_authorization', async () => {
    const res = await handler(makeEvent({}))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'missing_authorization' })
  })

  it('Authorization without Bearer prefix returns 401 invalid_authorization', async () => {
    const res = await handler(makeEvent({ authorization: 'Basic dXNlcjpwYXNz' }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_authorization' })
  })

  it('Bearer with invalid token format (not amk_xxx) returns 401 invalid_authorization', async () => {
    const res = await handler(makeEvent({ authorization: 'Bearer notavalidtoken' }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_authorization' })
  })

  it('Bearer with valid format but DDB returns nothing → 401 invalid_token', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const res = await handler(makeEvent({ authorization: 'Bearer amk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' })
  })

  it('Bearer matches a revoked token → 401 invalid_token', async () => {
    const meta = makeValidTokenMeta({ revokedAt: new Date().toISOString() })
    mockSend.mockResolvedValueOnce({ Item: { pk: 'mcp-tokens', sk: 'hash', value: JSON.stringify(meta) } })
    const res = await handler(makeEvent({ authorization: 'Bearer amk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' })
  })

  it('Bearer matches an expired token → 401 invalid_token', async () => {
    const meta = makeValidTokenMeta({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    mockSend.mockResolvedValueOnce({ Item: { pk: 'mcp-tokens', sk: 'hash', value: JSON.stringify(meta) } })
    const res = await handler(makeEvent({ authorization: 'Bearer amk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' })
  })

  it('Bearer matches a valid active token → 200 with ok/tokenPrefix/scope', async () => {
    const meta = makeValidTokenMeta()
    mockSend.mockResolvedValueOnce({ Item: { pk: 'mcp-tokens', sk: 'hash', value: JSON.stringify(meta) } })
    const res = await handler(makeEvent({ authorization: 'Bearer amk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.tokenPrefix).toBe('amk_AbCd')
    expect(body.scope).toEqual({ siteId: null })
  })
})
