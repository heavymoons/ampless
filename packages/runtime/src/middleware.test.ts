import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// next/server is implemented for the edge runtime. In a plain vitest
// environment we mock just the surface the middleware touches.
//
// NextResponse.next / NextResponse.rewrite return a Response-like
// object we can introspect. Headers are exposed as a real `Headers`
// instance so the middleware's `response.headers.set('Cache-Control',
// ...)` lands on something with a working `get`.

vi.mock('next/server', () => {
  class FakeResponse {
    headers = new Headers()
    status: number
    body: string | null
    rewrittenTo?: URL
    requestHeaders?: Headers
    kind: 'next' | 'rewrite' | 'response'
    constructor(
      body: string | null,
      init?: { status?: number },
      kind: 'next' | 'rewrite' | 'response' = 'response',
    ) {
      this.body = body
      this.status = init?.status ?? 200
      this.kind = kind
    }
    static rewrite(url: URL, init?: { request?: { headers?: Headers } }) {
      const r = new FakeResponse(null, undefined, 'rewrite')
      r.rewrittenTo = url
      r.requestHeaders = init?.request?.headers
      return r
    }
    static next(init?: { request?: { headers?: Headers } }) {
      const r = new FakeResponse(null, undefined, 'next')
      r.requestHeaders = init?.request?.headers
      return r
    }
  }
  return { NextResponse: FakeResponse }
})

import {
  createAmplessMiddleware,
  computeCacheControl,
  defaultMatcherConfig,
  _resetFlagCache,
} from './middleware.js'
import type { Config, PostMetadata } from 'ampless'

function makeReq(host: string, pathname: string, search = ''): unknown {
  const headers = new Headers({ host })
  const url = new URL(`http://${host}${pathname}${search}`)
  return {
    headers,
    nextUrl: {
      clone() {
        return new URL(url.toString())
      },
    },
  }
}

const BASE_CONFIG: Config = { site: { name: 'X', url: 'https://x' } }
const OPTS = {
  cmsConfig: BASE_CONFIG,
  appsyncUrl: 'https://appsync.example.com/graphql',
  apiKey: 'da2-fake',
}

// Helper: build an AppSync getPublishedPost response payload.
function appsyncPayload(post: {
  format: string
  metadata?: PostMetadata | null
  updatedAt?: string | null
} | null) {
  return {
    data: {
      getPublishedPost: post
        ? {
            format: post.format,
            metadata: post.metadata != null ? JSON.stringify(post.metadata) : null,
            updatedAt: post.updatedAt ?? null,
          }
        : null,
    },
  }
}

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): void {
  const ok = init.ok ?? true
  const status = init.status ?? 200
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      async json() {
        return body
      },
    })) as unknown as typeof fetch,
  )
}

beforeEach(() => {
  _resetFlagCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createAmplessMiddleware — passthroughs', () => {
  it('passes / (home) through without rewrite or AppSync call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = await mw(makeReq('x.example.com', '/') as never) as unknown as {
      kind: string
      rewrittenTo?: URL
    }
    expect(res.kind).toBe('next')
    expect(res.rewrittenTo).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes reserved prefixes (feed.xml, sitemap.xml, og, tag, raw, static) through', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    for (const path of ['/feed.xml', '/sitemap.xml', '/og/x', '/tag/hello', '/raw/x', '/static/x']) {
      const res = (await mw(makeReq('x.example.com', path) as never)) as unknown as {
        kind: string
      }
      expect(res.kind).toBe('next')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes /llms.txt through as a reserved prefix (no AppSync flag fetch)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/llms.txt') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('createAmplessMiddleware — MCP discovery well-known', () => {
  function optsWithAi(ai: Config['ai']): typeof OPTS {
    return { ...OPTS, cmsConfig: { ...BASE_CONFIG, ai } }
  }

  it('rewrites /.well-known/mcp/catalog.json → /api/mcp/catalog.json when both flags on', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(optsWithAi({ publicMcp: true, mcpDiscovery: true }))
    const res = (await mw(
      makeReq('x.example.com', '/.well-known/mcp/catalog.json') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/api/mcp/catalog.json')
    // Rewrite decision is flag-only — no AppSync flag fetch.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does NOT rewrite when only publicMcp is on (mcpDiscovery off) — passthrough', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(optsWithAi({ publicMcp: true }))
    const res = (await mw(
      makeReq('x.example.com', '/.well-known/mcp/catalog.json') as never,
    )) as unknown as { kind: string }
    // `.well-known` is a reserved prefix → passthrough (no rewrite, no fetch).
    expect(res.kind).toBe('next')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does NOT rewrite when both flags are off — passthrough', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/.well-known/mcp/catalog.json') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes other /.well-known/* paths through without an AppSync flag fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(optsWithAi({ publicMcp: true, mcpDiscovery: true }))
    for (const path of ['/.well-known/mcp-registry-auth', '/.well-known/foo', '/.well-known/mcp/other.json']) {
      const res = (await mw(makeReq('x.example.com', path) as never)) as unknown as { kind: string }
      expect(res.kind).toBe('next')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a post slugged ".well-known" never reaches the themed route (reserved slug)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/.well-known') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('createAmplessMiddleware — routing by post flags', () => {
  it('themed post: passes /<slug> through (no rewrite)', async () => {
    mockFetch(
      appsyncPayload({
        format: 'markdown',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL; headers: Headers }
    expect(res.kind).toBe('next')
    expect(res.rewrittenTo).toBeUndefined()
    // Cache-Control still set even for themed passthroughs.
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=300/)
  })

  it('no_layout HTML: rewrites /<slug> → /raw/<slug>', async () => {
    mockFetch(
      appsyncPayload({
        format: 'html',
        metadata: { no_layout: true },
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/promo') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/raw/promo')
  })

  it('static post: rewrites /<slug> → /static/<slug>', async () => {
    mockFetch(
      appsyncPayload({
        format: 'static',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/site') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/static/site')
  })

  it('static post: rewrites /<slug>/<path> → /static/<slug>/<path>', async () => {
    mockFetch(
      appsyncPayload({
        format: 'static',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/site/assets/style.css') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/static/site/assets/style.css')
  })

  it('themed post + sub-path: returns 404 (themed posts have no sub-paths)', async () => {
    mockFetch(
      appsyncPayload({
        format: 'markdown',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello/extra') as never,
    )) as unknown as { status: number }
    expect(res.status).toBe(404)
  })

  it('html without no_layout: passes through as themed (no rewrite)', async () => {
    // format=html stays themed by default — only `no_layout: true`
    // unlocks the bare-HTML route. Themes are free to render html
    // through their own Post component.
    mockFetch(
      appsyncPayload({
        format: 'html',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('next')
    expect(res.rewrittenTo).toBeUndefined()
  })
})

describe('createAmplessMiddleware — .md markdown routes', () => {
  it('rewrites /<slug>.md → /md/<slug> and sets Cache-Control', async () => {
    mockFetch(
      appsyncPayload({
        format: 'markdown',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/foo.md') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL; headers: Headers }
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/md/foo')
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=300/)
  })

  it('a post slugged "foo.md" (public URL /foo.md.md, as emitted by llms.txt) is queried and rewritten with the slug intact', async () => {
    // llms.txt links to `/<slug>.md`; for a post whose slug is itself
    // `foo.md` that produces `/foo.md.md`. Middleware strips exactly
    // one trailing `.md`, leaving `foo.md` as both the AppSync flags
    // lookup key and the `/md/<slug>` rewrite target — the md route
    // handler must NOT strip a second time (see md.ts / md.test.ts).
    const fetchSpy = vi.fn(async (_url: unknown, init: { body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { variables?: { slug?: string } }
      expect(body.variables?.slug).toBe('foo.md')
      return {
        ok: true,
        status: 200,
        async json() {
          return appsyncPayload({
            format: 'markdown',
            metadata: null,
            updatedAt: '2020-01-01T00:00:00.000Z',
          })
        },
      }
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/foo.md.md') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/md/foo.md')
  })

  it('rewrites regardless of post format (tiptap / markdown / html / static)', async () => {
    for (const format of ['tiptap', 'markdown', 'html', 'static'] as const) {
      _resetFlagCache()
      mockFetch(
        appsyncPayload({
          format,
          metadata: null,
          updatedAt: '2020-01-01T00:00:00.000Z',
        }),
      )
      const mw = createAmplessMiddleware(OPTS)
      const res = (await mw(
        makeReq('x.example.com', '/foo.md') as never,
      )) as unknown as { kind: string; rewrittenTo?: URL }
      expect(res.kind).toBe('rewrite')
      expect(res.rewrittenTo?.pathname).toBe('/md/foo')
    }
  })

  it('returns an explicit 404 for /<slug>.md when the stripped slug has no post (no themed passthrough)', async () => {
    mockFetch(appsyncPayload(null))
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/nope.md') as never,
    )) as unknown as { kind?: string; status: number }
    expect(res.status).toBe(404)
    expect(res.kind).not.toBe('next')
  })

  it('a post whose real slug is literally "foo.md" is unreachable at /foo.md while markdownRoutes is enabled (spec, not a bug)', async () => {
    // The AppSync lookup uses the *stripped* slug ('foo'), never the
    // literal 'foo.md' slug, so a post that really is slugged
    // 'foo.md' can't be found this way — the middleware 404s instead
    // of falling back to a themed resolution of the untouched URL.
    mockFetch(appsyncPayload(null))
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/foo.md') as never,
    )) as unknown as { kind?: string; status: number }
    expect(res.status).toBe(404)
    expect(res.kind).not.toBe('next')
  })

  it('markdownRoutes: false — /<slug>.md is not special-cased; slug "foo.md" resolves normally (themed passthrough)', async () => {
    // Regression: a real post slugged 'foo.md' still renders themed
    // at /foo.md once markdownRoutes is disabled — pre-.md-feature
    // behaviour, unchanged.
    const disabledOpts = {
      ...OPTS,
      cmsConfig: { ...BASE_CONFIG, ai: { markdownRoutes: false } },
    }
    mockFetch(
      appsyncPayload({
        format: 'markdown',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(disabledOpts)
    const res = (await mw(
      makeReq('x.example.com', '/foo.md') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('next')
    expect(res.rewrittenTo).toBeUndefined()
  })

  it('markdownRoutes: false — a missing post at /<slug>.md falls through to themed 404 handling (not middleware 404)', async () => {
    const disabledOpts = {
      ...OPTS,
      cmsConfig: { ...BASE_CONFIG, ai: { markdownRoutes: false } },
    }
    mockFetch(appsyncPayload(null))
    const mw = createAmplessMiddleware(disabledOpts)
    const res = (await mw(
      makeReq('x.example.com', '/nope.md') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
  })

  it('passes /md/<slug> direct hits through via RESERVED_PREFIXES (no AppSync call)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/md/foo') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('multi-segment /<slug>/file.md still resolves as a static-bundle sub-path (regression)', async () => {
    mockFetch(
      appsyncPayload({
        format: 'static',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/site/file.md') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/static/site/file.md')
  })

  it('a bare "/.md" path (slug === ".md") is not treated as a markdown request (length guard) and falls through to themed 404 handling', async () => {
    mockFetch(appsyncPayload(null))
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/.md') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
  })
})

describe('createAmplessMiddleware — .md non-ASCII slug decoding', () => {
  it('decodes a percent-encoded slug for the flags lookup, but rewrites using the still-encoded segment', async () => {
    // llms.txt emits `.md` links with the slug percent-encoded
    // (`fixedEncodeURIComponent`). `URL#pathname` doesn't decode that,
    // so the raw stripped segment reaching middleware is `caf%C3%A9` —
    // the flags query must decode it to `café` to find the post, while
    // the rewrite target keeps the encoded form (Next.js decodes the
    // `[slug]` route param for the `/md/[slug]` handler).
    const fetchSpy = vi.fn(async (_url: unknown, init: { body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { variables?: { slug?: string } }
      expect(body.variables?.slug).toBe('café')
      return {
        ok: true,
        status: 200,
        async json() {
          return appsyncPayload({
            format: 'markdown',
            metadata: null,
            updatedAt: '2020-01-01T00:00:00.000Z',
          })
        },
      }
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/caf%C3%A9.md') as never,
    )) as unknown as { kind: string; rewrittenTo?: URL }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(res.kind).toBe('rewrite')
    expect(res.rewrittenTo?.pathname).toBe('/md/caf%C3%A9')
  })

  it('malformed percent-encoding falls back to the raw slug (no throw) and 404s when nothing matches', async () => {
    const fetchSpy = vi.fn(async (_url: unknown, init: { body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { variables?: { slug?: string } }
      expect(body.variables?.slug).toBe('%E0%A4')
      return {
        ok: true,
        status: 200,
        async json() {
          return appsyncPayload(null)
        },
      }
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/%E0%A4.md') as never,
    )) as unknown as { status: number; kind?: string }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(404)
  })
})

describe('createAmplessMiddleware — missing post handling', () => {
  it('passes /<slug> through when AppSync returns null (themed handles 404)', async () => {
    mockFetch(appsyncPayload(null))
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/ghost') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
  })

  it('returns 404 directly for /<slug>/<path> when post missing', async () => {
    mockFetch(appsyncPayload(null))
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/ghost/anything') as never,
    )) as unknown as { status: number }
    expect(res.status).toBe(404)
  })

  it('passes through when AppSync 5xx (themed handles 404)', async () => {
    mockFetch({ data: null }, { ok: false, status: 502 })
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
  })

  it('passes through when AppSync returns GraphQL errors', async () => {
    mockFetch({ data: null, errors: [{ message: 'boom' }] })
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
  })

  it('passes through when fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network')
      }) as unknown as typeof fetch,
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello') as never,
    )) as unknown as { kind: string }
    expect(res.kind).toBe('next')
  })
})

describe('createAmplessMiddleware — caching', () => {
  it('LRU caches a slug across requests within the TTL', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return appsyncPayload({
          format: 'markdown',
          metadata: null,
          updatedAt: '2020-01-01T00:00:00.000Z',
        })
      },
    }))
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    await mw(makeReq('x.example.com', '/hello') as never)
    await mw(makeReq('x.example.com', '/hello') as never)
    await mw(makeReq('x.example.com', '/hello') as never)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('caches null (post missing) so 404s stay cheap', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return appsyncPayload(null)
      },
    }))
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    await mw(makeReq('x.example.com', '/ghost') as never)
    await mw(makeReq('x.example.com', '/ghost') as never)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('computeCacheControl', () => {
  it("strategy='hot' always emits no-store", () => {
    const hc = computeCacheControl(
      {
        metadata: { cache: 'hot' },
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=0, must-revalidate, s-maxage=0')
  })

  it("strategy='deep' uses deepTtlSeconds (default 3600)", () => {
    const hc = computeCacheControl(
      { metadata: { cache: 'deep' }, updatedAt: '2020-01-01T00:00:00.000Z' },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=3600, s-maxage=3600')
  })

  it("strategy='deep' honours cms.config.cache.deepTtlSeconds override", () => {
    const hc = computeCacheControl(
      { metadata: { cache: 'deep' }, updatedAt: '2020-01-01T00:00:00.000Z' },
      { ...BASE_CONFIG, cache: { deepTtlSeconds: 7200 } },
    )
    expect(hc).toBe('public, max-age=7200, s-maxage=7200')
  })

  it("strategy='auto' within cooldown → no-store", () => {
    const recent = new Date(Date.now() - 60_000).toISOString() // 1 min ago
    const hc = computeCacheControl(
      { metadata: { cache: 'auto' }, updatedAt: recent },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=0, must-revalidate, s-maxage=0')
  })

  it("strategy='auto' beyond cooldown → freshTtl (default 300)", () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    const hc = computeCacheControl(
      { metadata: { cache: 'auto' }, updatedAt: old },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=300, s-maxage=300')
  })

  it("absent metadata.cache defaults to 'auto'", () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const hc = computeCacheControl(
      { metadata: null, updatedAt: old },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=300, s-maxage=300')
  })

  it("missing updatedAt treated as old (freshTtl)", () => {
    const hc = computeCacheControl(
      { metadata: { cache: 'auto' }, updatedAt: '' },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=300, s-maxage=300')
  })

  it('cms.config.cache.cooldownMs / freshTtlSeconds overrides apply', () => {
    const recent = new Date(Date.now() - 1000).toISOString() // 1 sec ago
    // Override cooldown to a single millisecond — 1-second-old should
    // be "beyond cooldown" → freshTtl override (10 sec).
    const hc = computeCacheControl(
      { metadata: { cache: 'auto' }, updatedAt: recent },
      { ...BASE_CONFIG, cache: { cooldownMs: 1, freshTtlSeconds: 10 } },
    )
    expect(hc).toBe('public, max-age=10, s-maxage=10')
  })

  it("cache='deep' is independent of metadata.no_layout (orthogonal flags)", () => {
    const hc = computeCacheControl(
      {
        metadata: { cache: 'deep', no_layout: true },
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
      BASE_CONFIG,
    )
    expect(hc).toBe('public, max-age=3600, s-maxage=3600')
  })
})

describe('createAmplessMiddleware — preview headers', () => {
  it('forwards ?previewTheme=<name> to x-preview-theme header on /', async () => {
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/', '?previewTheme=docs') as never,
    )) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-preview-theme')).toBe('docs')
  })

  it('forwards ?previewColorScheme=<mode> on /', async () => {
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/', '?previewColorScheme=dark') as never,
    )) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-preview-color-scheme')).toBe('dark')
  })

  it('forwards preview headers on a post passthrough', async () => {
    mockFetch(
      appsyncPayload({
        format: 'markdown',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello', '?previewTheme=blog') as never,
    )) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-preview-theme')).toBe('blog')
  })

  it('drops spoofed preview headers when no preview query is present', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const spoofedHeaders = new Headers({
      host: 'x.example.com',
      'x-preview-theme': 'docs',
      'x-preview-color-scheme': 'dark',
    })
    const url = new URL('http://x.example.com/')
    const req = {
      headers: spoofedHeaders,
      nextUrl: { clone() { return new URL(url.toString()) } },
    }
    const res = (await mw(req as never)) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-preview-theme')).toBeNull()
    expect(res.requestHeaders?.get('x-preview-color-scheme')).toBeNull()
  })
})

describe('createAmplessMiddleware — x-ampless-pathname marker', () => {
  it('sets x-ampless-pathname to "/" on home passthrough', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/') as never,
    )) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-ampless-pathname')).toBe('/')
  })

  it('sets x-ampless-pathname on a themed post passthrough', async () => {
    mockFetch(
      appsyncPayload({
        format: 'markdown',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/hello-world') as never,
    )) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-ampless-pathname')).toBe('/hello-world')
  })

  it('sets x-ampless-pathname on a raw rewrite', async () => {
    mockFetch(
      appsyncPayload({
        format: 'html',
        metadata: { no_layout: true },
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/promo') as never,
    )) as unknown as { kind: string; requestHeaders?: Headers }
    expect(res.kind).toBe('rewrite')
    expect(res.requestHeaders?.get('x-ampless-pathname')).toBe('/promo')
  })

  it('sets x-ampless-pathname on a static rewrite', async () => {
    mockFetch(
      appsyncPayload({
        format: 'static',
        metadata: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    )
    const mw = createAmplessMiddleware(OPTS)
    const res = (await mw(
      makeReq('x.example.com', '/site') as never,
    )) as unknown as { kind: string; requestHeaders?: Headers }
    expect(res.kind).toBe('rewrite')
    expect(res.requestHeaders?.get('x-ampless-pathname')).toBe('/site')
  })

  it('overwrites a spoofed incoming x-ampless-pathname header', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    // Simulate an attacker supplying a spoofed header on the incoming request.
    const spoofedHeaders = new Headers({ host: 'x.example.com', 'x-ampless-pathname': '/evil' })
    const url = new URL('http://x.example.com/')
    const req = {
      headers: spoofedHeaders,
      nextUrl: { clone() { return new URL(url.toString()) } },
    }
    const res = (await mw(req as never)) as unknown as { requestHeaders?: Headers }
    // The middleware must overwrite with the real pathname, not the attacker's value.
    expect(res.requestHeaders?.get('x-ampless-pathname')).toBe('/')
  })
})

describe('defaultMatcherConfig', () => {
  it('exports a sensible default matcher config', () => {
    expect(defaultMatcherConfig.matcher).toHaveLength(1)
    // The matcher pattern itself is a valid JS regex — Next.js uses
    // it directly. Building a RegExp from it confirms validity.
    const re = new RegExp('^' + defaultMatcherConfig.matcher[0]! + '$')
    expect(re.test('/admin/foo')).toBe(false)
    expect(re.test('/api/foo')).toBe(false)
    expect(re.test('/login')).toBe(false)
    expect(re.test('/about')).toBe(true)
  })
})
