import { describe, it, expect, vi, beforeEach } from 'vitest'

// `generateServerClientUsingReqRes` and `createServerRunner` are Amplify
// SSR plumbing that don't work outside a Next.js / Amplify request context.
// Mock them here so the resolver shape and stateless context can be asserted
// in isolation.

const FAKE_CTX = { token: { value: 'ctx' } }

const mockRunWithContext = vi.fn(
  ({
    operation,
  }: {
    nextServerContext: unknown
    operation: (ctx: unknown) => unknown
  }) => operation(FAKE_CTX)
)

vi.mock('@aws-amplify/adapter-nextjs', () => ({
  createServerRunner: () => ({ runWithAmplifyServerContext: mockRunWithContext }),
}))

const mockGetMediaBySrc = vi.fn()

vi.mock('@aws-amplify/adapter-nextjs/api', () => ({
  generateServerClientUsingReqRes: () => ({
    queries: {
      getMediaBySrc: (...args: unknown[]) => mockGetMediaBySrc(...args),
    },
  }),
}))

import { createMediaApi } from './media.js'
import type { AmplessOutputs } from './outputs.js'

const FAKE_OUTPUTS = {} as unknown as AmplessOutputs

beforeEach(() => {
  mockRunWithContext.mockReset()
  mockRunWithContext.mockImplementation(
    ({
      operation,
    }: {
      nextServerContext: unknown
      operation: (ctx: unknown) => unknown
    }) => operation(FAKE_CTX)
  )
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
    expect(mockGetMediaBySrc).toHaveBeenCalledWith(FAKE_CTX, {
      src: 'public/media/2026/05/photo.jpg',
    })
    expect(mockRunWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ nextServerContext: null })
    )
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
