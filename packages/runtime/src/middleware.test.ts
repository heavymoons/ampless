import { describe, it, expect, vi } from 'vitest'

// next/server is implemented for the edge runtime. In a plain vitest
// environment we mock just the surface the middleware touches —
// NextResponse.rewrite returns a Response-like value with the headers
// we want to assert on; the constructor signature for error returns
// uses the same shape.
vi.mock('next/server', () => {
  class FakeResponse {
    headers = new Map<string, string>()
    status: number
    body: string | null
    rewrittenTo?: URL
    requestHeaders?: Headers
    constructor(body: string | null, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    static rewrite(url: URL, init?: { request?: { headers?: Headers } }) {
      const r = new FakeResponse(null)
      r.rewrittenTo = url
      r.requestHeaders = init?.request?.headers
      return r
    }
  }
  return { NextResponse: FakeResponse }
})

import { createAmplessMiddleware, defaultMatcherConfig } from './middleware.js'

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

describe('createAmplessMiddleware', () => {
  it('rewrites / → /site/default', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/') as never) as unknown as {
      rewrittenTo?: URL
      headers: Map<string, string>
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default')
  })

  it('rewrites /about → /site/default/about', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/about') as never) as unknown as {
      rewrittenTo?: URL
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default/about')
  })

  it('rewrites /_/<slug> → /site/default/r/<slug>', () => {
    // Unified `_` routing is data-driven (post.metadata.no_layout or
    // format='static' → dispatcher redirects to /_/<slug>). Middleware
    // translates the public `_` prefix to the routable `r/` folder
    // because Next.js excludes any underscore-prefixed path part
    // from App Router discovery.
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/_/promo') as never) as unknown as {
      rewrittenTo?: URL
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default/r/promo')
  })

  it('rewrites /_/<slug>/<file> → /site/default/r/<slug>/<file>', () => {
    // Static-bundle internal file path: the trailing path joins the
    // optional catch-all `[[...path]]` segment inside the unified
    // route handler.
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(
      makeReq('x.example.com', '/_/promo/assets/style.css') as never,
    ) as unknown as { rewrittenTo?: URL }
    expect(res.rewrittenTo?.pathname).toBe('/site/default/r/promo/assets/style.css')
  })

  it('rewrites /_/<slug>/ (trailing slash) → /site/default/r/<slug>/', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/_/promo/') as never) as unknown as {
      rewrittenTo?: URL
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default/r/promo/')
  })

  it('does NOT special-case .html slug suffix', () => {
    // Regression guard: the legacy `/<slug>.html` → /raw/<slug>.html
    // rewrite was retired in favour of `metadata.no_layout`. Slugs
    // ending in .html should now be treated as ordinary post URLs.
    // (And /raw/ itself was retired in favour of /_/<slug>.)
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/promo.html') as never) as unknown as {
      rewrittenTo?: URL
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default/promo.html')
  })

  it('forwards ?previewTheme=<name> to x-preview-theme header', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(
      makeReq('x.example.com', '/', '?previewTheme=docs') as never
    ) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-preview-theme')).toBe('docs')
  })

  it('forwards ?previewColorScheme=<mode> to x-preview-color-scheme header', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(
      makeReq('x.example.com', '/', '?previewColorScheme=dark') as never
    ) as unknown as { requestHeaders?: Headers }
    expect(res.requestHeaders?.get('x-preview-color-scheme')).toBe('dark')
  })

  it('does not set Cache-Control (no longer force-disabled)', () => {
    // Single-site mode: no per-deploy host disambiguation needed, so
    // edge caching is left to the route's own directives.
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/') as never) as unknown as {
      headers: Map<string, string>
    }
    expect(res.headers.get('Cache-Control')).toBeUndefined()
  })

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
