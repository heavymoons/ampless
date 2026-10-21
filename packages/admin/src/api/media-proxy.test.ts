import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { Admin } from '../index.js'

// The route delegates byte transfer to `streamS3Object` from
// @ampless/runtime and presigning to Amplify's `getUrl`. Mock both so
// the test only asserts how the Amplify server runner is invoked.

const mockGetUrl = vi.fn()
vi.mock('aws-amplify/storage/server', () => ({
  getUrl: (...args: unknown[]) => mockGetUrl(...args),
}))

vi.mock('@ampless/runtime', () => ({
  streamS3Object: async (
    _ctx: unknown,
    _key: string,
    opts: { presignedUrlFor: (k: string) => Promise<string | null> },
  ) => {
    const url = await opts.presignedUrlFor('public/media/a.png')
    return new Response(url ?? 'none', { status: 200 })
  },
}))

import { createMediaProxyRoute } from './media-proxy.js'

describe('createMediaProxyRoute', () => {
  beforeEach(() => {
    mockGetUrl.mockReset()
    mockGetUrl.mockResolvedValue({ url: new URL('https://s3.example.com/signed') })
  })

  it('runs stream and presign with the stateless guest context (nextServerContext: null)', async () => {
    const runner = vi.fn(
      async (args: { nextServerContext: unknown; operation: (ctx: unknown) => Promise<unknown> }) =>
        args.operation({}),
    )
    const admin = {
      amplifyServer: { runWithAmplifyServerContext: runner },
      getMediaBySrc: vi.fn(async () => null),
    } as unknown as Admin

    const { GET } = createMediaProxyRoute(admin)
    const res = await GET({} as NextRequest, {
      params: Promise.resolve({ path: ['media', 'a.png'] }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    // stream + presign
    expect(runner).toHaveBeenCalledTimes(2)
    for (const [args] of runner.mock.calls) {
      expect(args.nextServerContext).toBeNull()
    }
  })
})
