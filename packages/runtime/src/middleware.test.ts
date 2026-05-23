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

  it('passes reserved prefixes (feed.xml, sitemap.xml, og, tag, r) through', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const mw = createAmplessMiddleware(OPTS)
    for (const path of ['/feed.xml', '/sitemap.xml', '/og/x', '/tag/hello', '/r/x']) {
      const res = (await mw(makeReq('x.example.com', path) as never)) as unknown as {
        kind: string
      }
      expect(res.kind).toBe('next')
    }
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

  it('no_layout HTML: rewrites /<slug> → /r/<slug>', async () => {
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
    expect(res.rewrittenTo?.pathname).toBe('/r/promo')
  })

  it('static post: rewrites /<slug> → /r/<slug>', async () => {
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
    expect(res.rewrittenTo?.pathname).toBe('/r/site')
  })

  it('static post: rewrites /<slug>/<path> → /r/<slug>/<path>', async () => {
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
    expect(res.rewrittenTo?.pathname).toBe('/r/site/assets/style.css')
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
