import { describe, it, expect, vi, beforeEach } from 'vitest'

// The helper depends on Amplify SSR `getProperties` for the HEAD
// fallback and global `fetch` for the actual byte transfer. Mock both
// so unit tests can drive every branch.

const mockGetProperties = vi.fn()
vi.mock('aws-amplify/storage/server', () => ({
  getProperties: (...args: unknown[]) => mockGetProperties(...args),
}))
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}))

import { streamS3Object, _resetStreamS3Cache } from './stream-s3.js'

function fakeContext(): unknown {
  // streamS3Object never inspects the context directly — it forwards
  // it to `getProperties`. Passing a plain object satisfies the
  // function signature without depending on the adapter internals.
  return { token: { value: {} } }
}

function fakeFetchResponse(body: string, init?: ResponseInit) {
  const bytes = new TextEncoder().encode(body)
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': String(bytes.byteLength),
      ETag: '"abc"',
    },
    ...init,
  })
}

beforeEach(() => {
  _resetStreamS3Cache()
  mockGetProperties.mockReset()
})

describe('streamS3Object', () => {
  it('streams small objects back when caller supplies meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeFetchResponse('hello')),
    )
    const presigned = vi.fn(async () => 'https://s3.example.com/signed')

    const res = await streamS3Object(fakeContext() as never, 'public/media/x.txt', {
      meta: { size: 5, mimeType: 'text/plain' },
      presignedUrlFor: presigned,
      cacheControl: 'public, max-age=31536000, immutable',
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain')
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(presigned).toHaveBeenCalledTimes(1)
    expect(await res.text()).toBe('hello')
    // No HEAD round-trip when meta is supplied.
    expect(mockGetProperties).not.toHaveBeenCalled()
  })

  it('falls back to a 302 when size exceeds the threshold', async () => {
    const presigned = vi.fn(async () => 'https://s3.example.com/signed')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await streamS3Object(fakeContext() as never, 'public/media/big', {
      meta: { size: 10 * 1024 * 1024, mimeType: 'image/jpeg' },
      presignedUrlFor: presigned,
      thresholdBytes: 6 * 1024 * 1024,
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/signed')
    expect(presigned).toHaveBeenCalledTimes(1)
    // No bytes-fetch on the 302 path — the browser does the GET to S3.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses headFallback when meta is missing and caches the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse('hi')))
    const headFallback = vi.fn(async () => ({ size: 2, mimeType: 'text/plain' }))
    const presigned = vi.fn(async () => 'https://s3.example.com/signed')

    const first = await streamS3Object(fakeContext() as never, 'k', {
      headFallback,
      presignedUrlFor: presigned,
    })
    expect(first.status).toBe(200)
    expect(headFallback).toHaveBeenCalledTimes(1)

    // Same key — should hit the LRU and skip the headFallback.
    const second = await streamS3Object(fakeContext() as never, 'k', {
      headFallback,
      presignedUrlFor: presigned,
    })
    expect(second.status).toBe(200)
    expect(headFallback).toHaveBeenCalledTimes(1)
  })

  it('falls through to Amplify getProperties when neither meta nor headFallback resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse('xyz')))
    mockGetProperties.mockResolvedValueOnce({
      size: 3,
      contentType: 'application/octet-stream',
      eTag: '"e"',
    })
    const presigned = vi.fn(async () => 'https://s3.example.com/signed')

    const res = await streamS3Object(fakeContext() as never, 'k2', {
      presignedUrlFor: presigned,
    })

    expect(res.status).toBe(200)
    expect(mockGetProperties).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when nothing resolves the metadata', async () => {
    mockGetProperties.mockRejectedValueOnce(new Error('NoSuchKey'))
    const presigned = vi.fn(async () => null)

    const res = await streamS3Object(fakeContext() as never, 'k3', {
      presignedUrlFor: presigned,
    })

    expect(res.status).toBe(404)
    // presign should not have been called — we 404'd before that step.
    expect(presigned).not.toHaveBeenCalled()
  })

  it('returns 404 when the presigned URL itself cannot be minted', async () => {
    const presigned = vi.fn(async () => null)

    const res = await streamS3Object(fakeContext() as never, 'k4', {
      meta: { size: 10, mimeType: 'text/plain' },
      presignedUrlFor: presigned,
    })

    expect(res.status).toBe(404)
  })

  it('returns 502 when the upstream fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network fail')
      }),
    )
    const presigned = vi.fn(async () => 'https://s3.example.com/signed')

    const res = await streamS3Object(fakeContext() as never, 'k5', {
      meta: { size: 10, mimeType: 'text/plain' },
      presignedUrlFor: presigned,
    })

    expect(res.status).toBe(502)
  })

  it('maps upstream 403/404 to a 404 (handles object-deleted race)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('Forbidden', { status: 403 }),
      ),
    )
    const presigned = vi.fn(async () => 'https://s3.example.com/signed')

    const res = await streamS3Object(fakeContext() as never, 'k6', {
      meta: { size: 10, mimeType: 'text/plain' },
      presignedUrlFor: presigned,
    })

    expect(res.status).toBe(404)
  })
})
