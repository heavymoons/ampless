import { describe, it, expect, vi, beforeEach } from 'vitest'

// Set env before importing handler (top-level requireEnv throws otherwise).
process.env['AMPLESS_MCP_TOKEN_TABLE'] = 'McpToken-test'
process.env['AMPLESS_APPSYNC_URL'] = 'https://example.appsync-api.us-east-1.amazonaws.com/graphql'
process.env['AMPLESS_BUCKET_NAME'] = 'test-bucket'
process.env['AWS_REGION'] = 'us-east-1'

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

// Mock the AppSync GraphQL client so tools/call doesn't try to hit
// AppSync (and doesn't load the SigV4 / credential machinery, which
// the test environment doesn't need to validate).
const mockGraphqlQuery = vi.fn()
vi.mock('./mcp-graphql-client.js', () => {
  return {
    createMcpGraphqlClient: () => ({
      query: (op: string, vars?: Record<string, unknown>) => mockGraphqlQuery(op, vars),
    }),
  }
})

// Mock the S3 StorageClient so upload_media tests don't need real AWS
// credentials. `mockPutObject` is a spy we can assert against.
const mockPutObject = vi.fn()
vi.mock('./mcp-storage-client.js', () => {
  return {
    createMcpStorageClient: () => ({
      putObject: (key: string, body: Uint8Array, contentType: string) =>
        mockPutObject(key, body, contentType),
    }),
  }
})

// Dynamic import so the module-level DDB client construction picks up
// the mocks registered above.
const { handler } = await import('./mcp-handler.js')

// --- helpers ---

interface EventOpts {
  method?: string
  authorization?: string
  body?: unknown
  rawBody?: string
}

function makeEvent(opts: EventOpts): Parameters<typeof handler>[0] {
  const headers: Record<string, string> = {}
  if (opts.authorization) headers['authorization'] = opts.authorization

  let body: string | undefined
  if (opts.rawBody !== undefined) {
    body = opts.rawBody
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
  }

  return {
    headers,
    body,
    requestContext: { http: { method: opts.method ?? 'POST' } },
  }
}

function makeValidTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    hash: 'abc123',
    prefix: 'amk_AbCd',
    createdBy: 'sub-1',
    createdByEmail: 'admin@example.com',
    issuedAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

const VALID_TOKEN = 'Bearer amk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function mockValidTokenLookup(overrides: Record<string, unknown> = {}) {
  const row = makeValidTokenRow(overrides)
  mockSend.mockResolvedValueOnce({ Item: row })
  return row
}

// --- tests ---

describe('mcp-handler', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockGraphqlQuery.mockReset()
    mockPutObject.mockReset()
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
    const res = await handler(makeEvent({ authorization: VALID_TOKEN }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' })
  })

  it('Bearer matches a revoked token → 401 invalid_token', async () => {
    mockValidTokenLookup({ revokedAt: new Date().toISOString() })
    const res = await handler(makeEvent({ authorization: VALID_TOKEN }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' })
  })

  it('Bearer matches an expired token → 401 invalid_token', async () => {
    mockValidTokenLookup({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const res = await handler(makeEvent({ authorization: VALID_TOKEN }))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' })
  })

  // --- JSON-RPC dispatch ---

  it('initialize returns 200 with protocolVersion + tools capability', async () => {
    mockValidTokenLookup()
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result.protocolVersion).toBe('2024-11-05')
    expect(body.result.capabilities).toEqual({ tools: {} })
    expect(body.result.serverInfo).toMatchObject({ name: 'ampless-mcp' })
  })

  it('tools/list returns the full tool registry including upload_media', async () => {
    mockValidTokenLookup()
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const names = (body.result.tools as { name: string }[]).map((t) => t.name)
    expect(names).toContain('list_posts')
    expect(names).toContain('get_post')
    expect(names).toContain('create_post')
    expect(names).toContain('update_post')
    expect(names).toContain('delete_post')
    expect(names).toContain('get_schema')
    // upload_media is available over HTTP transport
    expect(names).toContain('upload_media')
    // Static-bundle tools.
    expect(names).toContain('upload_static_bundle')
    expect(names).toContain('upload_static_file')
    expect(names).toContain('delete_static_file')
    expect(names).toContain('commit_static_post')
  })

  it('tools/call list_posts dispatches via the mocked graphql client', async () => {
    mockValidTokenLookup()
    mockGraphqlQuery.mockResolvedValueOnce({
      listPosts: { items: [], nextToken: null },
    })
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_posts', arguments: { status: 'all' } },
        },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe(3)
    expect(body.result.content[0].type).toBe('text')
    // The graphql client mock returned an empty list; the tool wraps
    // it as `{ posts: [], nextToken: null }`.
    const payload = JSON.parse(body.result.content[0].text)
    expect(payload).toEqual({ posts: [], nextToken: null })
    expect(mockGraphqlQuery).toHaveBeenCalledOnce()
  })

  it('tools/call upload_media dispatches via storage.putObject and creates a Media row', async () => {
    mockValidTokenLookup()
    const base64Data = Buffer.from('fake-image-bytes').toString('base64')
    mockPutObject.mockResolvedValueOnce(
      'https://test-bucket.s3.us-east-1.amazonaws.com/public/media/2026/05/1234-photo.jpg'
    )
    mockGraphqlQuery.mockResolvedValueOnce({
      createMedia: {
        mediaId: 'media-123',
        src: 'public/media/2026/05/1234-photo.jpg',
        mimeType: 'image/jpeg',
        size: 16,
        delivery: 'nextjs',
      },
    })
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'upload_media',
            arguments: {
              filename: 'photo.jpg',
              mimeType: 'image/jpeg',
              base64Data,
            },
          },
        },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.error).toBeUndefined()
    expect(body.result.content[0].type).toBe('text')
    // storage.putObject should have been called with the decoded bytes
    expect(mockPutObject).toHaveBeenCalledOnce()
    const [key, uploadedBody, contentType] = mockPutObject.mock.calls[0] as [string, Uint8Array, string]
    expect(key).toMatch(/^public\/media\/\d{4}\/\d{2}\/\d+-photo\.jpg$/)
    expect(contentType).toBe('image/jpeg')
    expect(Buffer.from(uploadedBody).toString()).toBe('fake-image-bytes')
    // graphql should have been called for createMedia
    expect(mockGraphqlQuery).toHaveBeenCalledOnce()
    const result = JSON.parse(body.result.content[0].text)
    expect(result.media.mediaId).toBe('media-123')
  })

  it('tools/call upload_media with minimal base64 (single byte) decodes correctly', async () => {
    mockValidTokenLookup()
    const singleByte = Buffer.from([0xff]).toString('base64') // '/w=='
    mockPutObject.mockResolvedValueOnce('https://test-bucket.s3.us-east-1.amazonaws.com/public/media/2026/05/1-tiny.bin')
    mockGraphqlQuery.mockResolvedValueOnce({
      createMedia: {
        mediaId: 'media-1',
        src: 'public/media/2026/05/1-tiny.bin',
        mimeType: 'application/octet-stream',
        size: 1,
        delivery: 'nextjs',
      },
    })
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: {
          jsonrpc: '2.0',
          id: 41,
          method: 'tools/call',
          params: {
            name: 'upload_media',
            arguments: {
              filename: 'tiny.bin',
              mimeType: 'application/octet-stream',
              base64Data: singleByte,
            },
          },
        },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.error).toBeUndefined()
    expect(mockPutObject).toHaveBeenCalledOnce()
    const [, uploadedBody] = mockPutObject.mock.calls[0] as [string, Uint8Array, string]
    expect(uploadedBody[0]).toBe(0xff)
    expect(uploadedBody.length).toBe(1)
  })

  it('tools/call without a name parameter returns invalid-params', async () => {
    mockValidTokenLookup()
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe(-32602)
  })

  it('unknown JSON-RPC method returns method-not-found', async () => {
    mockValidTokenLookup()
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: { jsonrpc: '2.0', id: 6, method: 'mystery/probe' },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe(-32601)
  })

  it('invalid JSON body returns 400 with parse-error code', async () => {
    mockValidTokenLookup()
    const res = await handler(
      makeEvent({ authorization: VALID_TOKEN, rawBody: '{not-json}' })
    )
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe(-32700)
  })

  it('JSON-RPC envelope missing required fields returns invalid-request', async () => {
    mockValidTokenLookup()
    const res = await handler(
      makeEvent({ authorization: VALID_TOKEN, body: { foo: 'bar' } })
    )
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe(-32600)
  })

  it('empty body returns invalid-request (not parse error)', async () => {
    mockValidTokenLookup()
    const res = await handler(makeEvent({ authorization: VALID_TOKEN, rawBody: '' }))
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe(-32600)
  })

  it('tool error surfaces as isError content (not a JSON-RPC error)', async () => {
    mockValidTokenLookup()
    mockGraphqlQuery.mockRejectedValueOnce(new Error('AppSync exploded'))
    const res = await handler(
      makeEvent({
        authorization: VALID_TOKEN,
        body: {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'list_posts', arguments: {} },
        },
      })
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('AppSync exploded')
  })
})
