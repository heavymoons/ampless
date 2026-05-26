import { describe, it, expect, vi, beforeEach } from 'vitest'

// `generateServerClientUsingCookies` builds an Amplify server client
// that doesn't work outside a Next.js request — mock it with a
// configurable queries surface so the resolver shape can be asserted
// in isolation.

const mockGetMediaBySrc = vi.fn()

vi.mock('@aws-amplify/adapter-nextjs/api', () => ({
  generateServerClientUsingCookies: () => ({
    queries: {
      getMediaBySrc: (...args: unknown[]) => mockGetMediaBySrc(...args),
    },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}))

import { createMediaApi } from './media.js'
import type { AmplessOutputs } from './outputs.js'

const FAKE_OUTPUTS = {} as unknown as AmplessOutputs

beforeEach(() => {
  mockGetMediaBySrc.mockReset()
})

describe('createMediaApi — getMediaBySrc', () => {
  it('resolves a single Media row when the query returns data', async () => {
    mockGetMediaBySrc.mockResolvedValueOnce({
      data: {
        src: 'public/media/2026/05/photo.jpg',
        size: 12345,
        mimeType: 'image/jpeg',
        metadata: '{"etag":"abc123"}',
      },
      errors: null,
    })

    const api = createMediaApi(FAKE_OUTPUTS)
    const res = await api.getMediaBySrc('public/media/2026/05/photo.jpg')

    expect(res).toEqual({
      src: 'public/media/2026/05/photo.jpg',
      size: 12345,
      mimeType: 'image/jpeg',
      metadata: { etag: 'abc123' },
    })
    expect(mockGetMediaBySrc).toHaveBeenCalledWith({
      src: 'public/media/2026/05/photo.jpg',
    })
  })

  it('returns null when the query yields no data (orphan asset)', async () => {
    mockGetMediaBySrc.mockResolvedValueOnce({ data: null })

    const api = createMediaApi(FAKE_OUTPUTS)
    const res = await api.getMediaBySrc('public/media/missing.jpg')

    expect(res).toBeNull()
  })

  it('returns null and logs when AppSync returns errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetMediaBySrc.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'unauthorized' }],
    })

    const api = createMediaApi(FAKE_OUTPUTS)
    const res = await api.getMediaBySrc('public/media/x.jpg')

    expect(res).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('returns null and logs when the query throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetMediaBySrc.mockRejectedValueOnce(new Error('network'))

    const api = createMediaApi(FAKE_OUTPUTS)
    const res = await api.getMediaBySrc('public/media/x.jpg')

    expect(res).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('handles missing optional fields by surfacing nulls', async () => {
    mockGetMediaBySrc.mockResolvedValueOnce({
      data: {
        src: 'public/media/x.bin',
        // size, mimeType, metadata all omitted
      },
    })

    const api = createMediaApi(FAKE_OUTPUTS)
    const res = await api.getMediaBySrc('public/media/x.bin')

    expect(res).toEqual({
      src: 'public/media/x.bin',
      size: null,
      mimeType: null,
      metadata: null,
    })
  })
})
