import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listPostSummaries,
  listPostHistory,
  setPostsProvider,
  type PostsProvider,
  type PostSummary,
  type PostRevision,
} from './core.js'
import type { Post } from './types.js'

// A minimal provider stub. Only `listPostHistory` is exercised here; the
// other methods throw so an accidental call surfaces loudly.
function makeProvider(over: Partial<PostsProvider> = {}): PostsProvider {
  const notImpl = () => {
    throw new Error('not implemented in this test')
  }
  return {
    list: notImpl,
    get: notImpl,
    getById: notImpl,
    create: notImpl,
    update: notImpl,
    remove: notImpl,
    listPostHistory: notImpl,
    ...over,
  }
}

const SAMPLE: PostRevision = {
  postHistoryId: 'post-1#2026-06-05T00:00:00.000Z',
  postId: 'post-1',
  revisedAt: '2026-06-05T00:00:00.000Z',
  title: 'Hello',
  slug: 'hello',
  format: 'markdown',
  body: '# Hi',
  status: 'published',
  tags: ['a', 'b'],
}

const SAMPLE_POST: Post = {
  postId: 'post-1',
  slug: 'hello',
  title: 'Hello',
  excerpt: 'Intro',
  format: 'markdown',
  body: '# Hi',
  status: 'published',
  publishedAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
  tags: ['a', 'b'],
  metadata: { cache: 'auto' },
}

const SAMPLE_SUMMARY: PostSummary = {
  postId: SAMPLE_POST.postId,
  slug: SAMPLE_POST.slug,
  title: SAMPLE_POST.title,
  excerpt: SAMPLE_POST.excerpt,
  status: SAMPLE_POST.status,
  publishedAt: SAMPLE_POST.publishedAt,
  updatedAt: SAMPLE_POST.updatedAt,
  tags: SAMPLE_POST.tags ?? [],
}

describe('listPostHistory', () => {
  afterEach(() => {
    // Reset the module-level provider so tests don't leak into each other
    // or into the dummy-fallback case below.
    // @ts-expect-error — intentionally clearing for isolation.
    setPostsProvider(null)
  })

  it('returns an empty connection when no provider is configured', async () => {
    // @ts-expect-error — explicitly clear before asserting the fallback.
    setPostsProvider(null)
    const conn = await listPostHistory('post-1')
    expect(conn).toEqual({ items: [] })
  })

  it('delegates to the provider with postId and options', async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [SAMPLE], nextToken: 'tok-2' })
    setPostsProvider(makeProvider({ listPostHistory: listFn }))

    const conn = await listPostHistory('post-1', { limit: 20, nextToken: 'tok-1' })

    expect(listFn).toHaveBeenCalledWith('post-1', { limit: 20, nextToken: 'tok-1' })
    expect(conn.items).toEqual([SAMPLE])
    expect(conn.nextToken).toBe('tok-2')
  })

  it('passes through a connection with no nextToken (last page)', async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [SAMPLE] })
    setPostsProvider(makeProvider({ listPostHistory: listFn }))

    const conn = await listPostHistory('post-1')
    expect(conn.nextToken).toBeUndefined()
    expect(conn.items).toHaveLength(1)
  })
})

describe('listPostSummaries', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error — intentionally clearing for isolation.
    setPostsProvider(null)
  })

  it('delegates to provider.listSummaries when available', async () => {
    const listFn = vi.fn().mockResolvedValue([SAMPLE_POST])
    const listSummariesFn = vi.fn().mockResolvedValue([SAMPLE_SUMMARY])
    setPostsProvider(makeProvider({ list: listFn, listSummaries: listSummariesFn }))

    const summaries = await listPostSummaries({ status: 'all' })

    expect(listSummariesFn).toHaveBeenCalledWith({ status: 'all' })
    expect(listFn).not.toHaveBeenCalled()
    expect(summaries).toEqual([SAMPLE_SUMMARY])
  })

  it('falls back to list() once and strips body / metadata when listSummaries is absent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const listFn = vi.fn().mockResolvedValue([SAMPLE_POST])
    setPostsProvider(makeProvider({ list: listFn }))

    const summaries = await listPostSummaries({ status: 'draft' })

    expect(listFn).toHaveBeenCalledWith({ status: 'draft' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(summaries).toEqual([
      {
        postId: SAMPLE_POST.postId,
        slug: SAMPLE_POST.slug,
        title: SAMPLE_POST.title,
        excerpt: SAMPLE_POST.excerpt,
        status: SAMPLE_POST.status,
        publishedAt: SAMPLE_POST.publishedAt,
        updatedAt: SAMPLE_POST.updatedAt,
        tags: SAMPLE_POST.tags,
      },
    ])
    expect(summaries[0]).not.toHaveProperty('body')
    expect(summaries[0]).not.toHaveProperty('metadata')
  })
})
