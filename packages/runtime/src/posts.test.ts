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

const mockListPublishedPosts = vi.fn()
const mockGetPublishedPost = vi.fn()
const mockListPostsByTag = vi.fn()

vi.mock('@aws-amplify/adapter-nextjs/api', () => ({
  generateServerClientUsingReqRes: () => ({
    queries: {
      listPublishedPosts: (...args: unknown[]) => mockListPublishedPosts(...args),
      getPublishedPost: (...args: unknown[]) => mockGetPublishedPost(...args),
      listPostsByTag: (...args: unknown[]) => mockListPostsByTag(...args),
    },
  }),
}))

import { createPostsApi, PostListScanLimitError } from './posts.js'
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
  mockListPublishedPosts.mockReset()
  mockGetPublishedPost.mockReset()
  mockListPostsByTag.mockReset()
})

describe('createPostsApi — stateless apiKey reads', () => {
  describe('getPublishedPost', () => {
    it('maps a returned data row to a Post via toCorePost', async () => {
      mockGetPublishedPost.mockResolvedValueOnce({
        data: {
          postId: 'p1',
          slug: 'hello',
          title: 'T',
          format: 'markdown',
          status: 'published',
          publishedAt: '2026-01-01T00:00:00Z',
          tags: ['a'],
        },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.getPublishedPost('hello')

      expect(res).not.toBeNull()
      expect(res!.slug).toBe('hello')
      expect(res!.title).toBe('T')
      expect(res!.tags).toEqual(['a'])
      expect(mockGetPublishedPost).toHaveBeenCalledWith(FAKE_CTX, { slug: 'hello' })
      expect(mockRunWithContext).toHaveBeenCalledWith(
        expect.objectContaining({ nextServerContext: null })
      )
    })

    it('returns null when the query yields no data', async () => {
      mockGetPublishedPost.mockResolvedValueOnce({ data: null, errors: null })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.getPublishedPost('missing')

      expect(res).toBeNull()
    })

    it('throws when AppSync returns errors', async () => {
      mockGetPublishedPost.mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'boom' }],
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      await expect(api.getPublishedPost('bad')).rejects.toThrow('boom')
    })
  })

  describe('listPublishedPosts', () => {
    it('returns items and nextToken, calls with contextSpec and default limit', async () => {
      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: [], nextToken: null },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPublishedPosts()

      expect(res.items).toEqual([])
      expect(res.nextToken).toBeNull()
      expect(mockListPublishedPosts).toHaveBeenCalledWith(
        FAKE_CTX,
        expect.objectContaining({ limit: 20 })
      )
      expect(mockRunWithContext).toHaveBeenCalledWith(
        expect.objectContaining({ nextServerContext: null })
      )
    })

    it('forwards opts.limit and nextToken when provided', async () => {
      // nextToken null ends the listing, so this is a single call (a short
      // page WITH a token is followed up — see "page filling" below).
      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: [], nextToken: null },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      await api.listPublishedPosts({ limit: 5, nextToken: 'prev' })

      expect(mockListPublishedPosts).toHaveBeenCalledWith(
        FAKE_CTX,
        expect.objectContaining({ limit: 5, nextToken: 'prev' })
      )
    })
  })

  describe('page filling (resolvers may return short pages with a nextToken)', () => {
    function row(id: string) {
      return {
        postId: id,
        slug: id,
        title: id,
        format: 'markdown',
        status: 'published',
        publishedAt: '2026-01-01T00:00:00.000Z',
        tags: [],
      }
    }

    it('follows nextToken in chunks of 100 until the page is full', async () => {
      mockListPublishedPosts
        .mockResolvedValueOnce({ data: { items: [row('a')], nextToken: 't1' }, errors: null })
        .mockResolvedValueOnce({
          data: { items: [row('b'), row('c')], nextToken: 't2' },
          errors: null,
        })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPublishedPosts({ limit: 3, from: 'F', to: 'T' })

      expect(res.items.map((p) => p.postId)).toEqual(['a', 'b', 'c'])
      expect(res.nextToken).toBe('t2')
      expect(mockListPublishedPosts).toHaveBeenCalledTimes(2)
      expect(mockListPublishedPosts).toHaveBeenNthCalledWith(1, FAKE_CTX, {
        from: 'F',
        to: 'T',
        limit: 3,
        nextToken: undefined,
      })
      expect(mockListPublishedPosts).toHaveBeenNthCalledWith(2, FAKE_CTX, {
        from: 'F',
        to: 'T',
        limit: 100,
        nextToken: 't1',
      })
    })

    it('keeps going past an empty page that still has a nextToken', async () => {
      mockListPostsByTag
        .mockResolvedValueOnce({ data: { items: [], nextToken: 't1' }, errors: null })
        .mockResolvedValueOnce({ data: { items: [row('a')], nextToken: null }, errors: null })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPostsByTag('news', { limit: 2 })

      expect(res.items.map((p) => p.postId)).toEqual(['a'])
      expect(res.nextToken).toBeNull()
      expect(mockListPostsByTag).toHaveBeenNthCalledWith(2, FAKE_CTX, {
        tag: 'news',
        limit: 100,
        nextToken: 't1',
      })
    })

    it('makes a single call when the first page is already full', async () => {
      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: [row('a'), row('b')], nextToken: 't1' },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPublishedPosts({ limit: 2 })

      expect(res.items).toHaveLength(2)
      expect(res.nextToken).toBe('t1')
      expect(mockListPublishedPosts).toHaveBeenCalledTimes(1)
    })

    it('returns a resumable cursor when a chunk holds more posts than the page needs', async () => {
      mockListPublishedPosts
        .mockResolvedValueOnce({ data: { items: [], nextToken: 't1' }, errors: null })
        .mockResolvedValue({
          data: { items: [row('a'), row('b'), row('c')], nextToken: 't2' },
          errors: null,
        })

      const api = createPostsApi(FAKE_OUTPUTS)
      const first = await api.listPublishedPosts({ limit: 2 })
      expect(first.items.map((p) => p.postId)).toEqual(['a', 'b'])
      expect(first.nextToken).toMatch(/^ampless-c1\./)

      // The cursor re-reads the same chunk (start token t1, size 100) and
      // skips the two posts already returned.
      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: [row('a'), row('b'), row('c')], nextToken: null },
        errors: null,
      })
      const second = await api.listPublishedPosts({ limit: 2, nextToken: first.nextToken! })
      expect(mockListPublishedPosts).toHaveBeenLastCalledWith(FAKE_CTX, {
        from: undefined,
        to: undefined,
        limit: 100,
        nextToken: 't1',
      })
      expect(second).toEqual({ items: [expect.objectContaining({ postId: 'c' })], nextToken: null })
    })

    it('treats a token without the runtime prefix (or a malformed one) as a raw AppSync token', async () => {
      mockListPublishedPosts.mockResolvedValue({
        data: { items: [row('a')], nextToken: null },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      await api.listPublishedPosts({ limit: 1, nextToken: 'ampless-c1.not-json' })

      expect(mockListPublishedPosts).toHaveBeenCalledWith(FAKE_CTX, {
        from: undefined,
        to: undefined,
        limit: 1,
        nextToken: 'ampless-c1.not-json',
      })
    })

    it('does not honour a client-supplied cursor that asks for an oversized chunk', async () => {
      mockListPublishedPosts.mockResolvedValue({
        data: { items: [row('a')], nextToken: null },
        errors: null,
      })
      const forged =
        'ampless-c1.' +
        Buffer.from(JSON.stringify({ t: 'tok', s: 0, c: 100000 }), 'utf8').toString('base64url')

      const api = createPostsApi(FAKE_OUTPUTS)
      await api.listPublishedPosts({ limit: 1, nextToken: forged })

      // Treated as a raw (invalid-to-AppSync) token, not as a 100000-row read.
      expect(mockListPublishedPosts).toHaveBeenCalledWith(FAKE_CTX, {
        from: undefined,
        to: undefined,
        limit: 1,
        nextToken: forged,
      })
    })

    it('throws PostListScanLimitError after 20 calls instead of returning a short page', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      let n = 0
      mockListPublishedPosts.mockImplementation(async () => ({
        data: { items: n === 3 ? [row('x')] : [], nextToken: `t${++n}` },
        errors: null,
      }))

      const api = createPostsApi(FAKE_OUTPUTS)
      const err = await api.listPublishedPosts({ limit: 5 }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(PostListScanLimitError)
      const e = err as PostListScanLimitError
      expect(e.name).toBe('PostListScanLimitError')
      expect(e.operation).toBe('listPublishedPosts')
      expect(e.calls).toBe(20)
      expect(e.items.map((p) => p.postId)).toEqual(['x'])
      expect(e.nextToken).toMatch(/^ampless-c1\./)
      expect(mockListPublishedPosts).toHaveBeenCalledTimes(20)
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('listPublishedPosts'),
        expect.objectContaining({ calls: 20 })
      )

      // Resuming from the error continues right after the 20th call.
      mockListPublishedPosts.mockReset()
      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: [row('y')], nextToken: null },
        errors: null,
      })
      const resumed = await api.listPublishedPosts({ limit: 5, nextToken: e.nextToken })
      expect(mockListPublishedPosts).toHaveBeenCalledWith(FAKE_CTX, {
        from: undefined,
        to: undefined,
        limit: 100,
        nextToken: 't20',
      })
      expect(resumed).toEqual({ items: [expect.objectContaining({ postId: 'y' })], nextToken: null })
      error.mockRestore()
    })

    it('throws when a follow-up page returns errors', async () => {
      mockListPostsByTag
        .mockResolvedValueOnce({ data: { items: [], nextToken: 't1' }, errors: null })
        .mockResolvedValueOnce({ data: null, errors: [{ message: 'boom' }] })

      const api = createPostsApi(FAKE_OUTPUTS)
      await expect(api.listPostsByTag('news', { limit: 2 })).rejects.toThrow('boom')
    })
  })

  describe('listPostsByTag', () => {
    it('passes tag and default limit with contextSpec', async () => {
      mockListPostsByTag.mockResolvedValueOnce({
        data: { items: [], nextToken: null },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPostsByTag('news')

      expect(res.items).toEqual([])
      expect(mockListPostsByTag).toHaveBeenCalledWith(
        FAKE_CTX,
        expect.objectContaining({ tag: 'news', limit: 20 })
      )
      expect(mockRunWithContext).toHaveBeenCalledWith(
        expect.objectContaining({ nextServerContext: null })
      )
    })
  })
})
