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

import { createPostsApi } from './posts.js'
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
      mockListPublishedPosts.mockResolvedValueOnce({
        data: { items: [], nextToken: 'tok' },
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
