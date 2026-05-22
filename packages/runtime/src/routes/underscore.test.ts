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

function makeCtx(params: { siteId: string; slug: string; path?: string[] }) {
  return { params: Promise.resolve(params) }
}

const NO_LAYOUT_POST: Post = {
  postId: 'p1',
  siteId: 'default',
  slug: 'promo',
  title: 'Promo',
  format: 'html',
  body: '<!doctype html><html><body>Hi</body></html>',
  status: 'published',
  metadata: { no_layout: true },
}

const STATIC_POST: Post = {
  postId: 'p2',
  siteId: 'default',
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

describe('createUnderscoreRouteHandler — no_layout HTML', () => {
  it('returns the body verbatim with text/html for /_/<slug>', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST, body: '<!doctype html>BODY' }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/_/promo'),
      makeCtx({ siteId: 'default', slug: 'promo' }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe('<!doctype html>BODY')
  })

  it('404s when a sub-path is appended to a no_layout post', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/_/promo/x.css'),
      makeCtx({ siteId: 'default', slug: 'promo', path: ['x.css'] }),
    )
    expect(res.status).toBe(404)
  })
})

describe('createUnderscoreRouteHandler — static bundles', () => {
  it('308 redirects /_/<slug> (no trailing slash) to /_/<slug>/', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site'),
      makeCtx({ siteId: 'default', slug: 'site' }),
    )
    expect(res.status).toBe(308)
    expect(res.headers.get('Location')).toBe('https://x.example.com/_/site/')
  })

  it('302 redirects /_/<slug>/ (trailing slash) to a presigned URL for the entrypoint', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site/'),
      makeCtx({ siteId: 'default', slug: 'site' }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/signed')
    // Verify the S3 object path uses public/static/<siteId>/<slug>/<entrypoint>.
    expect(mockGetUrl).toHaveBeenCalledTimes(1)
    const call = mockGetUrl.mock.calls[0]
    expect(call?.[1]).toEqual({
      path: 'public/static/default/site/index.html',
      options: { expiresIn: 60 * 60 },
    })
  })

  it('302 redirects /_/<slug>/<file> to a presigned URL', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site/assets/style.css'),
      makeCtx({ siteId: 'default', slug: 'site', path: ['assets', 'style.css'] }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/signed')
    const call = mockGetUrl.mock.calls[0]
    expect(call?.[1]).toEqual({
      path: 'public/static/default/site/assets/style.css',
      options: { expiresIn: 60 * 60 },
    })
  })

  it('404s when the requested file is not in the manifest', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site/missing.html'),
      makeCtx({ siteId: 'default', slug: 'site', path: ['missing.html'] }),
    )
    expect(res.status).toBe(404)
    // We shouldn't hit S3 when the manifest pre-flight already says no.
    expect(mockGetUrl).not.toHaveBeenCalled()
  })

  it('400s on path traversal segments', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site/..%2Fevil'),
      makeCtx({ siteId: 'default', slug: 'site', path: ['..', 'evil'] }),
    )
    expect(res.status).toBe(400)
    expect(mockGetUrl).not.toHaveBeenCalled()
  })

  it('400s on null-byte segments', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site/bad'),
      makeCtx({ siteId: 'default', slug: 'site', path: ['bad\0file'] }),
    )
    expect(res.status).toBe(400)
  })

  it('404s when presign throws (e.g. missing S3 object)', async () => {
    mockGetUrl.mockRejectedValueOnce(new Error('not found'))
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/_/site/'),
      makeCtx({ siteId: 'default', slug: 'site' }),
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
      makeRequest('https://x.example.com/_/site/'),
      makeCtx({ siteId: 'default', slug: 'site' }),
    )
    expect(res.status).toBe(302)
    expect(mockGetUrl.mock.calls[0]?.[1]).toEqual({
      path: 'public/static/default/site/index.html',
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
      makeRequest('https://x.example.com/_/site/anything.html'),
      makeCtx({ siteId: 'default', slug: 'site', path: ['anything.html'] }),
    )
    expect(res.status).toBe(302)
    expect(mockGetUrl).toHaveBeenCalledTimes(1)
  })
})

describe('createUnderscoreRouteHandler — negative paths', () => {
  it('404s when the post is missing', async () => {
    const handler = createUnderscoreRouteHandler(makeAmpless({ post: null }))
    const res = await handler(
      makeRequest('https://x.example.com/_/missing'),
      makeCtx({ siteId: 'default', slug: 'missing' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for format=html without no_layout', async () => {
    const post: Post = { ...NO_LAYOUT_POST, metadata: {} }
    const handler = createUnderscoreRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/_/promo'),
      makeCtx({ siteId: 'default', slug: 'promo' }),
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
      makeRequest('https://x.example.com/_/promo'),
      makeCtx({ siteId: 'default', slug: 'promo' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for sub-path access against a non-static post', async () => {
    const handler = createUnderscoreRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/_/promo/style.css'),
      makeCtx({ siteId: 'default', slug: 'promo', path: ['style.css'] }),
    )
    expect(res.status).toBe(404)
  })
})
