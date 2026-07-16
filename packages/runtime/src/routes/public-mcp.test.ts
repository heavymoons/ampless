import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Post } from 'ampless'

import { createPublicMcpRouteHandler, _resetPublicMcpRateLimit } from './public-mcp.js'
import type { Ampless } from '../index.js'

// --- fixtures -----------------------------------------------------------

const PUBLISHED_A: Post = {
  postId: 'p1',
  slug: 'hello-world',
  title: 'Hello World',
  format: 'markdown',
  status: 'published',
  body: '# hi',
  excerpt: 'a greeting',
  tags: ['intro', 'news'],
  publishedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const PUBLISHED_B: Post = {
  postId: 'p2',
  slug: 'second-post',
  title: 'Second Post',
  format: 'markdown',
  status: 'published',
  body: 'body b',
  tags: ['news'],
  publishedAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
}

const DRAFT: Post = {
  postId: 'p3',
  slug: 'secret-draft',
  title: 'Secret Draft',
  format: 'markdown',
  status: 'draft',
  body: 'shhh',
}

interface MockOpts {
  publicMcp?: boolean | undefined
  posts?: Post[]
  // Posts reachable via getPublishedPost (published index). Drafts are
  // never included, mirroring the server-side published-only resolvers.
  getPost?: (slug: string) => Post | null
}

function makeAmpless(opts: MockOpts = {}): Ampless {
  const published = opts.posts ?? [PUBLISHED_A, PUBLISHED_B]
  return {
    cmsConfig: { ai: { publicMcp: opts.publicMcp } },
    listPublishedPosts: vi.fn(async () => ({ items: published, nextToken: null })),
    getPublishedPost: vi.fn(async (slug: string) => {
      if (opts.getPost) return opts.getPost(slug)
      return published.find((p) => p.slug === slug) ?? null
    }),
    postToMarkdown: vi.fn(async (post: Post) => `MD:${post.slug}`),
  } as unknown as Ampless
}

const URL_MCP = 'https://example.com/api/mcp'

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return new Request(URL_MCP, {
    method: 'POST',
    headers,
    body: stream,
    // Node requires an explicit half-duplex marker for a streaming body.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

function expectCors(res: Response): void {
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
  expect(res.headers.get('Access-Control-Allow-Headers')).toBe('content-type, mcp-protocol-version')
}

// --- tests --------------------------------------------------------------

describe('createPublicMcpRouteHandler', () => {
  beforeEach(() => {
    _resetPublicMcpRateLimit()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- gate ---

  describe('gate (ai.publicMcp)', () => {
    it.each([
      ['undefined', undefined],
      ['false', false],
    ])('POST 404s when publicMcp is %s', async (_label, flag) => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: flag as boolean }))
      const res = await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
      expect(res.status).toBe(404)
      expectCors(res)
    })

    it.each([
      ['undefined', undefined],
      ['false', false],
    ])('OPTIONS 404s when publicMcp is %s', async (_label, flag) => {
      const { OPTIONS } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: flag as boolean }))
      const res = await OPTIONS(new Request(URL_MCP, { method: 'OPTIONS' }))
      expect(res.status).toBe(404)
    })

    it('is active when publicMcp === true', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
      expect(res.status).toBe(200)
    })
  })

  // --- OPTIONS preflight ---

  it('OPTIONS returns 204 + full CORS headers when enabled', async () => {
    const { OPTIONS } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
    const res = await OPTIONS(new Request(URL_MCP, { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expectCors(res)
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  // --- JSON-RPC methods ---

  describe('JSON-RPC methods', () => {
    it('initialize negotiates the protocol version + returns serverInfo', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26' },
        })
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expectCors(res)
      const body = await res.json()
      expect(body.result.protocolVersion).toBe('2025-03-26')
      expect(body.result.serverInfo).toMatchObject({ name: 'ampless-mcp' })
    })

    it('tools/list returns the four public tools with readOnly annotations', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(jsonRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      const tools = body.result.tools as { name: string; annotations: Record<string, boolean> }[]
      const names = tools.map((t) => t.name).sort()
      expect(names).toEqual(['get_post', 'list_posts', 'list_tags', 'search_posts'])
      for (const t of tools) {
        expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
      }
    })

    it('tools/call list_posts returns allowlisted summaries', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_posts', arguments: {} },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.result.isError).toBeUndefined()
      const payload = JSON.parse(body.result.content[0].text)
      expect(payload.posts.map((p: { slug: string }) => p.slug)).toEqual([
        'hello-world',
        'second-post',
      ])
      // Field allowlist: no postId / status / body / metadata leaked.
      expect(payload.posts[0]).not.toHaveProperty('postId')
      expect(payload.posts[0]).not.toHaveProperty('status')
      expect(payload.posts[0]).not.toHaveProperty('body')
    })

    it('tools/call get_post renders markdown for a published slug', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'get_post', arguments: { slug: 'hello-world' } },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      const payload = JSON.parse(body.result.content[0].text)
      expect(payload.slug).toBe('hello-world')
      expect(payload.markdown).toBe('MD:hello-world')
    })

    it('tools/call search_posts finds a match over a bounded scan', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'search_posts', arguments: { query: 'Hello' } },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      const payload = JSON.parse(body.result.content[0].text)
      expect(payload.posts.map((p: { slug: string }) => p.slug)).toEqual(['hello-world'])
    })

    it('tools/call list_tags aggregates tag counts', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'list_tags', arguments: {} },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      const payload = JSON.parse(body.result.content[0].text)
      // 'news' appears on both posts, 'intro' on one.
      expect(payload.tags[0]).toEqual({ tag: 'news', count: 2 })
    })

    it('a notification returns 202 with an empty body + CORS + no-store', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(jsonRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }))
      expect(res.status).toBe(202)
      expect(await res.text()).toBe('')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expectCors(res)
    })

    it.each([
      ['empty body', ''],
      ['invalid JSON', '{not json}'],
      ['null scalar', 'null'],
      ['number scalar', '42'],
    ])('%s → 400 error body + CORS', async (_label, raw) => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(jsonRequest(raw))
      expect(res.status).toBe(400)
      expectCors(res)
      const body = await res.json()
      expect(body.error.code).toBeDefined
      expect(typeof body.error.code).toBe('number')
    })

    it('bad envelope (jsonrpc !== 2.0) → 400', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(jsonRequest({ jsonrpc: '1.0', id: 1, method: 'tools/list' }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe(-32600)
    })
  })

  // --- batch ---

  describe('batch', () => {
    it('mixed request + notification → array of the request response only, order preserved (200)', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest([
          { jsonrpc: '2.0', id: 'a', method: 'tools/list' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
        ])
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body.map((r: { id: unknown }) => r.id)).toEqual(['a', 'b'])
    })

    it('all-notification batch → 202 empty', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest([
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', method: 'x/y' },
        ])
      )
      expect(res.status).toBe(202)
      expect(await res.text()).toBe('')
    })

    it('empty batch → 400 invalid', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(jsonRequest([]))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe(-32600)
    })

    it('batch larger than MAX_BATCH (51) → 400 invalid', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const batch = Array.from({ length: 51 }, (_v, i) => ({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/list',
      }))
      const res = await POST(jsonRequest(batch))
      expect(res.status).toBe(400)
    })

    it('malformed-mixed batch: bad elements → id:null errors, notification excluded, order kept, 200', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest([
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          null,
          { jsonrpc: '2.0', id: 3 },
        ])
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.length).toBe(3)
      expect(body[0].id).toBe(1)
      expect(body[0].result).toBeDefined()
      expect(body[1].id).toBeNull()
      expect(body[1].error.code).toBe(-32600)
      expect(body[2].id).toBe(3)
      expect(body[2].error.code).toBe(-32600)
    })

    it('an initialize element inside a batch → that element is INVALID_REQUEST', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const res = await POST(
        jsonRequest([
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ])
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body[0].id).toBe(1)
      expect(body[0].error.code).toBe(-32600)
      expect(body[1].id).toBe(2)
      expect(body[1].result).toBeDefined()
    })
  })

  // --- published-only wiring ---

  it('get_post for a draft slug never reaches a draft (getPublishedPost returns null → tool error)', async () => {
    const ampless = makeAmpless({
      publicMcp: true,
      posts: [PUBLISHED_A],
      // Even when asked for the draft slug, the published index yields null.
      getPost: (slug) => (slug === PUBLISHED_A.slug ? PUBLISHED_A : null),
    })
    const { POST } = createPublicMcpRouteHandler(ampless)
    const res = await POST(
      jsonRequest({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'get_post', arguments: { slug: DRAFT.slug } },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Tool surfaced a not-found as isError; the draft body never leaks.
    expect(body.result.isError).toBe(true)
    expect(JSON.stringify(body)).not.toContain('shhh')
  })

  // --- body size cap (byte-capped) ---

  describe('body size cap', () => {
    it('Content-Length over 64KB → 413 without reading', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const req = new Request(URL_MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 + 1) },
        body: '{}',
      })
      const res = await POST(req)
      expect(res.status).toBe(413)
      expectCors(res)
    })

    it('stream without Content-Length that exceeds 64KB is aborted → 413', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      // Two 40KB chunks = 80KB, no content-length header.
      const chunk = new Uint8Array(40 * 1024).fill(0x78) // 'x'
      const res = await POST(streamRequest([chunk, chunk]))
      expect(res.status).toBe(413)
    })

    it('exactly 64KB of valid multibyte JSON is accepted and decoded intact (200)', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const enc = new TextEncoder()
      const base = { jsonrpc: '2.0', id: 1, method: 'tools/list', _pad: '' }
      const baseLen = enc.encode(JSON.stringify(base)).byteLength
      // Pad with 3-byte characters ('あ') + 1-byte filler to hit exactly 64KB.
      const target = 64 * 1024
      const remaining = target - baseLen
      const multibyteCount = Math.floor(remaining / 3)
      const filler = remaining - multibyteCount * 3
      const pad = 'あ'.repeat(multibyteCount) + 'x'.repeat(filler)
      const payload = JSON.stringify({ ...base, _pad: pad })
      expect(enc.encode(payload).byteLength).toBe(target)
      const res = await POST(jsonRequest(payload))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.result.tools).toBeDefined()
    })

    it('a 3-byte character straddling the 64KB boundary → 413 (no broken decode)', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      // 65535 filler bytes, then a 3-byte 'あ' whose 2nd/3rd bytes cross 65536.
      const head = new Uint8Array(64 * 1024 - 1).fill(0x78)
      const multibyte = new TextEncoder().encode('あ') // 3 bytes
      const res = await POST(streamRequest([head, multibyte]))
      expect(res.status).toBe(413)
    })
  })

  // --- circuit breaker ---

  describe('circuit breaker', () => {
    it('exceeding RATE_MAX (600) → 429 + Retry-After; batches charge per-element', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      // 12 batches of 50 = 600 units consumed. If a batch charged only 1
      // unit, 12 batches would consume 12 and the 13th request would NOT
      // be throttled — so reaching 429 here proves per-element charging.
      const batch = Array.from({ length: 50 }, (_v, i) => ({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/list',
      }))
      for (let i = 0; i < 12; i++) {
        const res = await POST(jsonRequest(batch))
        expect(res.status).toBe(200)
      }
      const over = await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
      expect(over.status).toBe(429)
      expect(Number(over.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
      expectCors(over)
      const body = await over.json()
      expect(body.error.code).toBe(-32000)
    })

    it('the window resets after RATE_WINDOW_MS elapses', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      try {
        const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
        const batch = Array.from({ length: 50 }, (_v, i) => ({
          jsonrpc: '2.0',
          id: i,
          method: 'tools/list',
        }))
        for (let i = 0; i < 12; i++) {
          await POST(jsonRequest(batch))
        }
        expect((await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).status).toBe(429)
        // Advance past the 60s fixed window.
        vi.setSystemTime(61_000)
        const after = await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
        expect(after.status).toBe(200)
      } finally {
        vi.useRealTimers()
      }
    })

    it('an empty batch charges exactly one unit (no reserve(-1) credit)', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      // 600 empty batches each 400 but each charging 1 unit; the 601st
      // request is throttled. If an empty batch credited -1, the budget
      // would never deplete and no 429 would ever appear.
      for (let i = 0; i < 600; i++) {
        const res = await POST(jsonRequest([]))
        expect(res.status).toBe(400)
      }
      const over = await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
      expect(over.status).toBe(429)
    })

    it('is instance-scoped: a rotating x-forwarded-for cannot dodge the budget', async () => {
      const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
      const batch = Array.from({ length: 50 }, (_v, i) => ({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/list',
      }))
      for (let i = 0; i < 12; i++) {
        await POST(jsonRequest(batch, { 'x-forwarded-for': `10.0.0.${i}` }))
      }
      // A brand-new spoofed client IP still hits the shared instance budget.
      const over = await POST(
        jsonRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'x-forwarded-for': '203.0.113.9' })
      )
      expect(over.status).toBe(429)
    })
  })

  // --- formatToolError ---

  it('formatToolError masks the client message and logs the raw detail server-side', async () => {
    const ampless = makeAmpless({ publicMcp: true })
    // Make the tool throw a detailed error.
    ampless.listPublishedPosts = vi.fn(async () => {
      throw new Error('SECRET internal detail')
    })
    const { POST } = createPublicMcpRouteHandler(ampless)
    const res = await POST(
      jsonRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_posts', arguments: {} },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe('Internal error while executing the tool.')
    expect(JSON.stringify(body)).not.toContain('SECRET internal detail')
    expect(console.error).toHaveBeenCalledWith(
      '[ampless] public MCP tool error',
      expect.any(Error)
    )
  })

  // --- outermost catch ---

  it('a body stream that throws mid-read → 500 + id:null internal-error + CORS + no-store (never a bare Next.js 500)', async () => {
    const { POST } = createPublicMcpRouteHandler(makeAmpless({ publicMcp: true }))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream boom'))
      },
    })
    const req = new Request(URL_MCP, {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const res = await POST(req)
    expect(res.status).toBe(500)
    expectCors(res)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.id).toBeNull()
    expect(body.error.code).toBe(-32603)
    expect(console.error).toHaveBeenCalledWith(
      '[ampless] public MCP route error',
      expect.any(Error)
    )
  })
})
