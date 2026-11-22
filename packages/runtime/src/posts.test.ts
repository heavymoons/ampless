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
      expect(first.nextToken).toMatch(/^ampless-c2\./)

      // The cursor re-reads the same chunk (start token t1, size 100) and
      // skips the two posts already returned (all three share one sort key,
      // so this goes through the tie id set).
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

    const cursor = (body: unknown, prefix = 'ampless-c2.') =>
      prefix + Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')

    it.each([
      ['no runtime prefix', 'plain-appsync-token'],
      ['malformed body', 'ampless-c2.not-json'],
      ['unreleased c1 cursor', cursor({ t: 'tok', s: 0, c: 100 }, 'ampless-c1.')],
      ['oversized chunk', cursor({ t: 'tok', k: 'x', ids: [], c: 100000 })],
      ['zero chunk', cursor({ t: 'tok', k: 'x', ids: [], c: 0 })],
      ['non-string key', cursor({ t: 'tok', k: 5, ids: [], c: 100 })],
      ['oversized key', cursor({ t: 'tok', k: 'x'.repeat(1025), ids: [], c: 100 })],
      ['ids not an array', cursor({ t: 'tok', k: 'x', ids: 'a', c: 100 })],
      ['non-string id', cursor({ t: 'tok', k: 'x', ids: [1], c: 100 })],
      [
        'too many tie ids',
        cursor({ t: 'tok', k: 'x', ids: Array.from({ length: 201 }, (_, i) => `p${i}`), c: 100 }),
      ],
      ['ids without a key', cursor({ t: 'tok', k: null, ids: ['a'], c: 100 })],
      ['non-string start token', cursor({ t: 7, k: 'x', ids: [], c: 100 })],
    ])('treats a token with %s as a raw AppSync token', async (_name, token) => {
      mockListPublishedPosts.mockResolvedValue({
        data: { items: [row('a')], nextToken: null },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      await api.listPublishedPosts({ limit: 1, nextToken: token })

      // Passed through unchanged with the caller's limit — never decoded into
      // a chunk read (so a forged cursor cannot ask for a huge chunk).
      expect(mockListPublishedPosts).toHaveBeenCalledWith(FAKE_CTX, {
        from: undefined,
        to: undefined,
        limit: 1,
        nextToken: token,
      })
    })

    it('orders anchor keys by UTF-8 bytes, as DynamoDB does (not by UTF-16 code units)', async () => {
      // U+1F600 sorts BELOW U+FF61 in UTF-16 (surrogate D83D < FF61) but ABOVE
      // it in UTF-8 (F0 > EF). Descending byte order is: x, emoji, ff61.
      const keyed = (id: string, publishedAt: string) => ({ ...row(id), publishedAt })
      const chunk = [keyed('x', '\u{1F601}'), keyed('emoji', '\u{1F600}'), keyed('ff61', '｡')]
      mockListPublishedPosts
        .mockResolvedValueOnce({ data: { items: [], nextToken: 't1' }, errors: null })
        .mockResolvedValueOnce({ data: { items: chunk, nextToken: null }, errors: null })

      const api = createPostsApi(FAKE_OUTPUTS)
      const first = await api.listPublishedPosts({ limit: 2 })
      expect(first.items.map((p) => p.postId)).toEqual(['x', 'emoji'])

      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: chunk, nextToken: null },
        errors: null,
      })
      const second = await api.listPublishedPosts({ limit: 2, nextToken: first.nextToken! })
      // A UTF-16 comparison would treat ff61 as "before" the anchor and drop it.
      expect(second.items.map((p) => p.postId)).toEqual(['ff61'])
    })

    it('anchors tag listings on publishedAt#postId', async () => {
      const at = '2026-01-01T00:00:00.000Z'
      const chunk = [row('c'), row('b'), row('a')].map((r) => ({ ...r, publishedAt: at }))
      mockListPostsByTag
        .mockResolvedValueOnce({ data: { items: [], nextToken: 't1' }, errors: null })
        .mockResolvedValueOnce({ data: { items: chunk, nextToken: null }, errors: null })

      const api = createPostsApi(FAKE_OUTPUTS)
      const first = await api.listPostsByTag('news', { limit: 1 })
      expect(first.items.map((p) => p.postId)).toEqual(['c'])
      const body = JSON.parse(
        Buffer.from(first.nextToken!.slice('ampless-c2.'.length), 'base64url').toString('utf8')
      )
      expect(body).toEqual({ t: 't1', k: `${at}#c`, ids: ['c'], c: 100 })
    })

    it('returns the whole chunk with its end token when a post cannot be anchored (no publishedAt)', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const keyless = { ...row('b'), publishedAt: null }
      mockListPublishedPosts
        .mockResolvedValueOnce({ data: { items: [], nextToken: 't1' }, errors: null })
        .mockResolvedValueOnce({
          data: { items: [row('a'), keyless, row('c')], nextToken: 't2' },
          errors: null,
        })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPublishedPosts({ limit: 2 })

      // Larger than the limit rather than a cursor that could skip or repeat.
      expect(res.items.map((p) => p.postId)).toEqual(['a', 'b', 'c'])
      expect(res.nextToken).toBe('t2')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('cannot be anchored'))
      error.mockRestore()
    })

    it('throws PostListScanLimitError after 20 EMPTY calls instead of returning a short page', async () => {
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
      // The one productive call (4th) is not counted against the budget.
      expect(e.calls).toBe(21)
      expect(e.emptyCalls).toBe(20)
      expect(e.items.map((p) => p.postId)).toEqual(['x'])
      expect(e.nextToken).toMatch(/^ampless-c2\./)
      expect(mockListPublishedPosts).toHaveBeenCalledTimes(21)
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('listPublishedPosts'),
        expect.objectContaining({ calls: 21, emptyCalls: 20 })
      )

      // Resuming from the error continues right after the 21st call.
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
        nextToken: 't21',
      })
      expect(resumed).toEqual({ items: [expect.objectContaining({ postId: 'y' })], nextToken: null })
      error.mockRestore()
    })

    it('30 productive calls of one post each fill a page of 30 without error (1 MB pages)', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      let n = 0
      mockListPublishedPosts.mockImplementation(async () => {
        n++
        return { data: { items: [row(`p${n}`)], nextToken: `t${n}` }, errors: null }
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPublishedPosts({ limit: 30 })

      expect(res.items).toHaveLength(30)
      expect(mockListPublishedPosts).toHaveBeenCalledTimes(30)
      expect(res.nextToken).toBe('t30')
      expect(error).not.toHaveBeenCalled()
      error.mockRestore()
    })

    it('fewer than 20 empty calls interleaved with productive ones still fill the page', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      let n = 0
      // Calls alternate empty / one post: 19 empty calls in total for 20 posts.
      mockListPublishedPosts.mockImplementation(async () => {
        n++
        const productive = n % 2 === 0 || n > 38
        return {
          data: { items: productive ? [row(`p${n}`)] : [], nextToken: `t${n}` },
          errors: null,
        }
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      const res = await api.listPublishedPosts({ limit: 20 })

      expect(res.items).toHaveLength(20)
      expect(error).not.toHaveBeenCalled()
      error.mockRestore()
    })

    it('fill: false makes exactly one resolver call and returns its raw token', async () => {
      mockListPublishedPosts.mockResolvedValue({
        data: { items: [], nextToken: 't1' },
        errors: null,
      })
      mockListPostsByTag.mockResolvedValue({
        data: { items: [row('a')], nextToken: 't2' },
        errors: null,
      })

      const api = createPostsApi(FAKE_OUTPUTS)
      expect(await api.listPublishedPosts({ limit: 5, fill: false })).toEqual({
        items: [],
        nextToken: 't1',
      })
      const tag = await api.listPostsByTag('news', { limit: 5, fill: false })
      expect(tag.items.map((p) => p.postId)).toEqual(['a'])
      expect(tag.nextToken).toBe('t2')
      expect(mockListPublishedPosts).toHaveBeenCalledTimes(1)
      expect(mockListPostsByTag).toHaveBeenCalledTimes(1)
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
