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
  it('rewrites / → /site/default in single-site mode', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/') as never) as unknown as {
      rewrittenTo?: URL
      headers: Map<string, string>
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default')
    expect(res.headers.get('x-site-id')).toBe('default')
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

  it('rewrites /promo.html → /site/default/raw/promo.html', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: { site: { name: 'X', url: 'https://x' } },
    })
    const res = mw(makeReq('x.example.com', '/promo.html') as never) as unknown as {
      rewrittenTo?: URL
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/default/raw/promo.html')
  })

  it('resolves multi-site host to the matching siteId', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: {
        site: { name: 'D', url: 'https://d' },
        sites: {
          blog: { domains: ['blog.example.com'], name: 'B', url: 'https://b' },
          docs: { domains: ['docs.example.com'], name: 'D', url: 'https://d' },
        },
      },
    })
    const res = mw(makeReq('blog.example.com', '/posts/x') as never) as unknown as {
      rewrittenTo?: URL
      headers: Map<string, string>
    }
    expect(res.rewrittenTo?.pathname).toBe('/site/blog/posts/x')
    expect(res.headers.get('x-site-id')).toBe('blog')
    // multi-site mode forces no-store
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('returns 404 for an unregistered multi-site host', () => {
    const mw = createAmplessMiddleware({
      cmsConfig: {
        site: { name: 'D', url: 'https://d' },
        sites: {
          blog: { domains: ['blog.example.com'], name: 'B', url: 'https://b' },
          docs: { domains: ['docs.example.com'], name: 'D', url: 'https://d' },
        },
      },
    })
    const res = mw(makeReq('unknown.example.com', '/') as never) as unknown as {
      status: number
    }
    expect(res.status).toBe(404)
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
