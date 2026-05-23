import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Post } from 'ampless'

// The unified handler pulls in Amplify SSR plumbing (createServerRunner +
// getUrl) for static-bundle presigning. Outside a Next.js / Amplify
// request context none of that is available, so we mock both modules.
// The mock for createServerRunner returns a runWithAmplifyServerContext
// stub that calls the supplied operation with a fake AmplifyContext —
// the operation immediately calls our mocked `getUrl` and gets back the
// canned presigned URL.

const mockGetUrl = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
  headers: async () => new Map(),
}))

vi.mock('aws-amplify/storage/server', () => ({
  getUrl: (...args: unknown[]) => mockGetUrl(...args),
}))

vi.mock('@aws-amplify/adapter-nextjs', () => ({
  createServerRunner: () => ({
    runWithAmplifyServerContext: async ({
      operation,
    }: {
      operation: (ctx: unknown) => Promise<unknown>
    }) => operation({}),
  }),
}))

import { createUnderscoreRouteHandler } from './underscore.js'
import type { Ampless } from '../index.js'

interface MockAmplessOpts {
  post: Post | null
  body?: string
}

function makeAmpless({ post, body = '<!doctype html>X' }: MockAmplessOpts): Ampless {
  return {
    outputs: {},
    getPublishedPost: vi.fn(async () => post),
    renderBody: vi.fn(() => body),
  } as unknown as Ampless
}

function makeRequest(url: string): Request {
  return new Request(url)
}

function makeCtx(params: { slug: string; path?: string[] }) {
  return { params: Promise.resolve(params) }
}

const NO_LAYOUT_POST: Post = {
  postId: 'p1',

  slug: 'promo',
  title: 'Promo',
  format: 'html',
  body: '<!doctype html><html><body>Hi</body></html>',
  status: 'published',
  metadata: { no_layout: true },
}

const STATIC_POST: Post = {
  postId: 'p2',

  slug: 'site',
  title: 'Site',
  format: 'static',
  body: {
    entrypoint: 'index.html',
    files: ['index.html', 'assets/style.css'],
    uploadedAt: '2026-01-01T00:00:00.000Z',
  },
  status: 'published',
}

beforeEach(() => {
  mockGetUrl.mockReset()
  mockGetUrl.mockResolvedValue({ url: new URL('https://s3.example.com/signed') })
})

// URLs in these tests use the public surface (`/<slug>(/<path>)`).
// The handler is invoked by Next.js after middleware rewrites
// `/<slug>(/<path>)` → `/r/<slug>(/<path>)` internally — `request.url`
// surfaces the original public URL, which is what the handler's
// trailing-slash redirect logic operates on.

describe('createUnderscoreRouteHandler — no_layout HTML', () => {
  it('returns the body verbatim with text/html for /<slug>', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST, body: '<!doctype html>BODY' }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe('<!doctype html>BODY')
  })

  it('does NOT set Cache-Control (middleware owns it)', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST, body: '<!doctype html>BODY' }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.headers.get('Cache-Control')).toBeNull()
  })

  it('404s when a sub-path is appended to a no_layout post', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/promo/x.css'),
      makeCtx({ slug: 'promo', path: ['x.css'] }),
    )
    expect(res.status).toBe(404)
  })
})

describe('createUnderscoreRouteHandler — static bundles', () => {
  it('308 redirects /<slug> (no trailing slash) to /<slug>/', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(308)
    expect(res.headers.get('Location')).toBe('https://x.example.com/site/')
  })

  it('302 redirects /<slug>/ (trailing slash) to a presigned URL for the entrypoint', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/signed')
    // Verify the S3 object path uses public/static/<slug>/<entrypoint>.
    expect(mockGetUrl).toHaveBeenCalledTimes(1)
    const call = mockGetUrl.mock.calls[0]
    expect(call?.[1]).toEqual({
      path: 'public/static/site/index.html',
      options: { expiresIn: 60 * 60 },
    })
  })

  it('302 redirects /<slug>/<file> to a presigned URL', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/assets/style.css'),
      makeCtx({ slug: 'site', path: ['assets', 'style.css'] }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/signed')
    const call = mockGetUrl.mock.calls[0]
    expect(call?.[1]).toEqual({
      path: 'public/static/site/assets/style.css',
      options: { expiresIn: 60 * 60 },
    })
  })

  it('404s when the requested file is not in the manifest', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/missing.html'),
      makeCtx({ slug: 'site', path: ['missing.html'] }),
    )
    expect(res.status).toBe(404)
    // We shouldn't hit S3 when the manifest pre-flight already says no.
    expect(mockGetUrl).not.toHaveBeenCalled()
  })

  it('400s on path traversal segments', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/..%2Fevil'),
      makeCtx({ slug: 'site', path: ['..', 'evil'] }),
    )
    expect(res.status).toBe(400)
    expect(mockGetUrl).not.toHaveBeenCalled()
  })

  it('400s on null-byte segments', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/bad'),
      makeCtx({ slug: 'site', path: ['bad\0file'] }),
    )
    expect(res.status).toBe(400)
  })

  it('404s when presign throws (e.g. missing S3 object)', async () => {
    mockGetUrl.mockRejectedValueOnce(new Error('not found'))
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(404)
  })

  it('falls back to index.html when the manifest omits entrypoint', async () => {
    const post: Post = {
      ...STATIC_POST,
      body: { files: ['index.html'], uploadedAt: '2026-01-01T00:00:00.000Z' },
    }
    const handler = createUnderscoreRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/site/'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(302)
    expect(mockGetUrl.mock.calls[0]?.[1]).toEqual({
      path: 'public/static/site/index.html',
      options: { expiresIn: 60 * 60 },
    })
  })

  it('skips the manifest pre-flight when files[] is empty', async () => {
    const post: Post = {
      ...STATIC_POST,
      body: { entrypoint: 'index.html', files: [], uploadedAt: '2026-01-01T00:00:00.000Z' },
    }
    const handler = createUnderscoreRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/site/anything.html'),
      makeCtx({ slug: 'site', path: ['anything.html'] }),
    )
    expect(res.status).toBe(302)
    expect(mockGetUrl).toHaveBeenCalledTimes(1)
  })
})

describe('createUnderscoreRouteHandler — negative paths', () => {
  it('404s when the post is missing', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: null }))
    const res = await handler(
      makeRequest('https://x.example.com/missing'),
      makeCtx({ slug: 'missing' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for format=html without no_layout (middleware never rewrites these here)', async () => {
    const post: Post = { ...NO_LAYOUT_POST, metadata: {} }
    const handler = createUnderscoreRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for tiptap / markdown posts', async () => {
    const tiptap: Post = {
      ...NO_LAYOUT_POST,
      format: 'tiptap',
      metadata: { no_layout: true },
    }
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: tiptap }))
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for sub-path access against a non-static post', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/promo/style.css'),
      makeCtx({ slug: 'promo', path: ['style.css'] }),
    )
    expect(res.status).toBe(404)
  })
})
