import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Post } from 'ampless'

// The static handler pulls in Amplify SSR plumbing (createServerRunner
// + getUrl + getProperties) for presigning + HEAD fallback, plus
// global `fetch` for the stream-back path. Outside a Next.js /
// Amplify request context none of that is available, so we mock each
// layer below.

const mockGetUrl = vi.fn()
const mockGetProperties = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
  headers: async () => new Map(),
}))

vi.mock('aws-amplify/storage/server', () => ({
  getUrl: (...args: unknown[]) => mockGetUrl(...args),
  getProperties: (...args: unknown[]) => mockGetProperties(...args),
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

import { createStaticRouteHandler } from './static.js'
import { _resetStreamS3Cache } from '../stream-s3.js'
import type { Ampless } from '../index.js'

interface MockAmplessOpts {
  post: Post | null
}

function makeAmpless({ post }: MockAmplessOpts): Ampless {
  return {
    outputs: {},
    getPublishedPost: vi.fn(async () => post),
    renderBody: vi.fn(async () => null),
    renderBodyHtmlString: vi.fn(() => ''),
  } as unknown as Ampless
}

function makeRequest(url: string): Request {
  return new Request(url)
}

function makeCtx(params: { slug: string; path?: string[] }) {
  return { params: Promise.resolve(params) }
}

// A static post whose metadata.files carries pre-resolved size +
// mimeType for every asset. This is the "happy path" — the route
// stream-backs the bytes (small files) or 302s (large files)
// without needing a HEAD round-trip.
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
  metadata: {
    files: {
      'index.html': { size: 200, mimeType: 'text/html; charset=utf-8' },
      'assets/style.css': { size: 100, mimeType: 'text/css; charset=utf-8' },
    },
  },
}

// Default fake upstream that the stream-back path fetches when it
// follows the presigned URL. Returns a 200 with a small body and
// the headers a real S3 response would carry.
function mockFetchOk(body = 'mock-body') {
  return vi.fn(async () => {
    const data = new TextEncoder().encode(body)
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': String(data.byteLength),
        ETag: '"abc123"',
      },
    })
  })
}

beforeEach(() => {
  _resetStreamS3Cache()
  mockGetUrl.mockReset()
  mockGetProperties.mockReset()
  mockGetUrl.mockResolvedValue({ url: new URL('https://s3.example.com/signed') })
  // Default global fetch — individual tests override as needed.
  vi.stubGlobal('fetch', mockFetchOk())
})

// URLs in these tests use the public surface (`/<slug>(/<path>)`). The
// handler is invoked by Next.js after middleware rewrites
// `/<slug>(/<path>)` → `/static/<slug>(/<path>)` internally. The
// trailing-slash redirect only relies on `request.url`'s *pathname*, not
// its host — under Amplify SSR / behind a proxy the host can be the
// internal origin (localhost:3000), so the Location must stay relative.

describe('createStaticRouteHandler — entrypoint', () => {
  it('308 redirects /<slug> (no trailing slash) to /<slug>/', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(308)
    // Host-relative Location so the public origin is preserved.
    expect(res.headers.get('Location')).toBe('/site/')
  })

  it('308 Location stays host-relative even when request.url is the internal origin', async () => {
    // Under Amplify SSR / behind a proxy, `request.url` surfaces the
    // internal origin (localhost:3000). An absolute Location built from
    // it would bounce the visitor off the public host — regression guard.
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('http://localhost:3000/site'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(308)
    const location = res.headers.get('Location')
    expect(location).toBe('/site/')
    expect(location).not.toContain('localhost')
  })

  it('308 preserves the query string in the relative Location', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site?utm=1'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(308)
    expect(res.headers.get('Location')).toBe('/site/?utm=1')
  })

  it('200 streams /<slug>/ (trailing slash) entrypoint bytes back via Lambda', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('ETag')).toBe('"abc123"')
    // Presigned URL was minted (1 call) and then fetched by the helper.
    expect(mockGetUrl).toHaveBeenCalledTimes(1)
    const call = mockGetUrl.mock.calls[0]
    expect(call?.[1]).toEqual({
      path: 'public/static/site/index.html',
      options: { expiresIn: 60 * 60 },
    })
  })

  it('falls back to index.html when the manifest omits entrypoint', async () => {
    const post: Post = {
      ...STATIC_POST,
      body: { files: ['index.html'], uploadedAt: '2026-01-01T00:00:00.000Z' },
    }
    const handler = createStaticRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/site/'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(200)
    expect(mockGetUrl.mock.calls[0]?.[1]).toEqual({
      path: 'public/static/site/index.html',
      options: { expiresIn: 60 * 60 },
    })
  })
})

describe('createStaticRouteHandler — internal files', () => {
  it('200 streams /<slug>/<file> back via Lambda using persisted metadata', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/assets/style.css'),
      makeCtx({ slug: 'site', path: ['assets', 'style.css'] }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    const call = mockGetUrl.mock.calls[0]
    expect(call?.[1]).toEqual({
      path: 'public/static/site/assets/style.css',
      options: { expiresIn: 60 * 60 },
    })
    // No HEAD fallback should fire when metadata.files has the entry.
    expect(mockGetProperties).not.toHaveBeenCalled()
  })

  it('falls back to a 302 when the asset is larger than the 6MB threshold', async () => {
    const bigPost: Post = {
      ...STATIC_POST,
      metadata: {
        files: {
          'big.bin': { size: 10 * 1024 * 1024, mimeType: 'application/octet-stream' },
        },
      },
      body: {
        entrypoint: 'index.html',
        files: ['big.bin'],
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    const handler = createStaticRouteHandler(makeAmpless({ post: bigPost }))
    const res = await handler(
      makeRequest('https://x.example.com/site/big.bin'),
      makeCtx({ slug: 'site', path: ['big.bin'] }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/signed')
  })

  it('uses HEAD fallback via Amplify getProperties for legacy posts without metadata.files', async () => {
    const legacyPost: Post = {
      ...STATIC_POST,
      metadata: undefined,
    }
    mockGetProperties.mockResolvedValueOnce({
      size: 50,
      contentType: 'text/css',
      eTag: '"legacy"',
    })
    const handler = createStaticRouteHandler(makeAmpless({ post: legacyPost }))
    const res = await handler(
      makeRequest('https://x.example.com/site/assets/style.css'),
      makeCtx({ slug: 'site', path: ['assets', 'style.css'] }),
    )
    expect(res.status).toBe(200)
    expect(mockGetProperties).toHaveBeenCalledTimes(1)
  })

  it('404s when the requested file is not in the manifest', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/missing.html'),
      makeCtx({ slug: 'site', path: ['missing.html'] }),
    )
    expect(res.status).toBe(404)
    expect(mockGetUrl).not.toHaveBeenCalled()
  })

  it('400s on path traversal segments', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/..%2Fevil'),
      makeCtx({ slug: 'site', path: ['..', 'evil'] }),
    )
    expect(res.status).toBe(400)
    expect(mockGetUrl).not.toHaveBeenCalled()
  })

  it('400s on null-byte segments', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/bad'),
      makeCtx({ slug: 'site', path: ['bad\0file'] }),
    )
    expect(res.status).toBe(400)
  })

  it('404s when presign throws (e.g. missing S3 object)', async () => {
    mockGetUrl.mockRejectedValueOnce(new Error('not found'))
    const handler = createStaticRouteHandler(makeAmpless({ post: STATIC_POST }))
    const res = await handler(
      makeRequest('https://x.example.com/site/'),
      makeCtx({ slug: 'site' }),
    )
    expect(res.status).toBe(404)
  })

  it('skips the manifest pre-flight when files[] is empty and falls back to HEAD', async () => {
    const post: Post = {
      ...STATIC_POST,
      body: { entrypoint: 'index.html', files: [], uploadedAt: '2026-01-01T00:00:00.000Z' },
      metadata: undefined,
    }
    mockGetProperties.mockResolvedValueOnce({
      size: 100,
      contentType: 'text/html',
      eTag: '"x"',
    })
    const handler = createStaticRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/site/anything.html'),
      makeCtx({ slug: 'site', path: ['anything.html'] }),
    )
    expect(res.status).toBe(200)
    expect(mockGetUrl).toHaveBeenCalledTimes(1)
  })
})

describe('createStaticRouteHandler — negative paths', () => {
  it('404s when the post is missing', async () => {
    const handler = createStaticRouteHandler(makeAmpless({ post: null }))
    const res = await handler(
      makeRequest('https://x.example.com/missing'),
      makeCtx({ slug: 'missing' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for non-static post formats (middleware bug guard)', async () => {
    for (const format of ['tiptap', 'markdown', 'html'] as const) {
      const post: Post = { ...STATIC_POST, format }
      const handler = createStaticRouteHandler(makeAmpless({ post }))
      const res = await handler(
        makeRequest('https://x.example.com/site/'),
        makeCtx({ slug: 'site' }),
      )
      expect(res.status).toBe(404)
    }
  })
})
