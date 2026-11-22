import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listPostSummaries,
  listPostHistory,
  mergePostMetadata,
  PostUpdateConflictError,
  setPostsProvider,
  updatePost,
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

describe('updatePost options', () => {
  afterEach(() => {
    // @ts-expect-error — intentionally clearing for isolation.
    setPostsProvider(null)
  })

  it('forwards expectedUpdatedAt to the provider', async () => {
    const updateFn = vi.fn().mockResolvedValue(SAMPLE_POST)
    setPostsProvider(makeProvider({ update: updateFn }))

    await updatePost('post-1', { title: 'T' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })
    await updatePost('post-1', { title: 'T' }, { expectedUpdatedAt: null })

    expect(updateFn).toHaveBeenNthCalledWith(1, 'post-1', { title: 'T' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })
    expect(updateFn).toHaveBeenNthCalledWith(2, 'post-1', { title: 'T' }, { expectedUpdatedAt: null })
  })

  it('calls a provider without options exactly as before', async () => {
    // A provider written against the two-argument signature still type-checks.
    const legacyUpdate = vi.fn(async (_postId: string, _data: Partial<Post>) => SAMPLE_POST)
    setPostsProvider(makeProvider({ update: legacyUpdate }))

    await updatePost('post-1', { title: 'T' })

    expect(legacyUpdate.mock.calls[0]).toEqual(['post-1', { title: 'T' }])
  })

  it('PostUpdateConflictError is an Error with its own name', () => {
    const err = new PostUpdateConflictError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PostUpdateConflictError')
    expect(new PostUpdateConflictError('custom').message).toBe('custom')
  })
})

describe('mergePostMetadata', () => {
  it('takes the stored value for keys the editor left unchanged', () => {
    expect(
      mergePostMetadata(
        { postClasses: ['a'], cache: 'deep' },
        { postClasses: ['a'], cache: 'deep' },
        { postClasses: ['b'], cache: 'deep', plugin_x: { n: 1 } }
      )
    ).toEqual({ postClasses: ['b'], cache: 'deep', plugin_x: { n: 1 } })
  })

  it("takes the editor's value for keys it changed", () => {
    expect(
      mergePostMetadata(
        { postClasses: ['a'], cache: 'deep' },
        { postClasses: ['c'], cache: 'deep' },
        { postClasses: ['b'], cache: 'hot', plugin_x: 1 }
      )
    ).toEqual({ postClasses: ['c'], cache: 'hot', plugin_x: 1 })
  })

  it('deletes a key the editor removed, and keeps a removal someone else made', () => {
    expect(
      mergePostMetadata(
        { postClasses: ['a'], no_layout: true },
        { no_layout: true },
        { postClasses: ['b'] }
      )
    ).toEqual(undefined)
    expect(mergePostMetadata({ cache: 'deep', seo: 1 }, { cache: 'deep', seo: 1 }, { seo: 1 })).toEqual({ seo: 1 })
  })

  it('adds a key the editor introduced', () => {
    expect(mergePostMetadata(undefined, { no_layout: true }, { cache: 'hot' })).toEqual({
      no_layout: true,
      cache: 'hot',
    })
  })

  it('compares deeply, so a re-created equal object counts as unchanged', () => {
    expect(
      mergePostMetadata({ seo: { title: 'X' } }, { seo: { title: 'X' } }, { seo: { title: 'Y' } })
    ).toEqual({ seo: { title: 'Y' } })
  })

  it('returns undefined for an empty result', () => {
    expect(mergePostMetadata(undefined, undefined, undefined)).toBeUndefined()
    expect(mergePostMetadata({ a: 1 }, {}, { a: 1 })).toBeUndefined()
  })
})
