import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConditionalUpdateUnsupportedError,
  listPostSummaries,
  listPostHistory,
  mergePostMetadata,
  mergeStaticContent,
  PostUpdateConflictError,
  setPostsProvider,
  supportsConditionalPostUpdate,
  updatePost,
  type PostsProvider,
  type PostSummary,
  type PostRevision,
  type StaticContentGroup,
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

  it('forwards expectedUpdatedAt to a provider that supports conditional updates', async () => {
    const updateFn = vi.fn().mockResolvedValue(SAMPLE_POST)
    setPostsProvider(makeProvider({ update: updateFn, supportsConditionalUpdate: true }))

    await updatePost('post-1', { title: 'T' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })
    await updatePost('post-1', { title: 'T' }, { expectedUpdatedAt: null })

    expect(updateFn).toHaveBeenNthCalledWith(1, 'post-1', { title: 'T' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })
    expect(updateFn).toHaveBeenNthCalledWith(2, 'post-1', { title: 'T' }, { expectedUpdatedAt: null })
    expect(supportsConditionalPostUpdate()).toBe(true)
  })

  it('refuses expectedUpdatedAt on a provider without the flag, and never calls its update', async () => {
    for (const flag of [undefined, false]) {
      const legacyUpdate = vi.fn(async (_postId: string, _data: Partial<Post>) => SAMPLE_POST)
      setPostsProvider(makeProvider({ update: legacyUpdate, ...(flag === undefined ? {} : { supportsConditionalUpdate: flag }) }))

      for (const expectedUpdatedAt of ['2026-06-01T00:00:00.000Z', null]) {
        const err = await updatePost('post-1', { title: 'T' }, { expectedUpdatedAt }).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(ConditionalUpdateUnsupportedError)
        expect((err as Error).name).toBe('ConditionalUpdateUnsupportedError')
      }
      expect(legacyUpdate).not.toHaveBeenCalled()
      expect(supportsConditionalPostUpdate()).toBe(false)
    }
  })

  it('calls a legacy provider without options exactly as before', async () => {
    // A provider written against the two-argument signature still type-checks.
    const legacyUpdate = vi.fn(async (_postId: string, _data: Partial<Post>) => SAMPLE_POST)
    setPostsProvider(makeProvider({ update: legacyUpdate }))

    await expect(updatePost('post-1', { title: 'T' })).resolves.toBe(SAMPLE_POST)

    expect(legacyUpdate.mock.calls).toEqual([['post-1', { title: 'T' }]])
  })

  it('supportsConditionalPostUpdate is false without a provider', () => {
    expect(supportsConditionalPostUpdate()).toBe(false)
  })

  it('the error classes are Errors with their own names', () => {
    const err = new PostUpdateConflictError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PostUpdateConflictError')
    expect(new PostUpdateConflictError('custom').message).toBe('custom')
    const unsupported = new ConditionalUpdateUnsupportedError()
    expect(unsupported).toBeInstanceOf(Error)
    expect(unsupported.name).toBe('ConditionalUpdateUnsupportedError')
    expect(unsupported.message).toContain('supportsConditionalUpdate')
  })
})

describe('mergePostMetadata', () => {
  describe('one-sided changes', () => {
    it('takes the stored value for keys the editor left unchanged', () => {
      expect(
        mergePostMetadata(
          { postClasses: ['a'], cache: 'deep' },
          { postClasses: ['a'], cache: 'deep' },
          { postClasses: ['b'], cache: 'deep', plugin_x: { n: 1 } }
        )
      ).toEqual({ metadata: { postClasses: ['b'], cache: 'deep', plugin_x: { n: 1 } }, conflicts: [] })
    })

    it("takes the editor's value for keys only it changed", () => {
      expect(
        mergePostMetadata(
          { postClasses: ['a'], cache: 'deep' },
          { postClasses: ['c'], cache: 'deep' },
          { postClasses: ['a'], cache: 'hot', plugin_x: 1 }
        )
      ).toEqual({ metadata: { postClasses: ['c'], cache: 'hot', plugin_x: 1 }, conflicts: [] })
    })

    it('deletes a key the editor removed, and keeps a removal someone else made', () => {
      expect(
        mergePostMetadata({ postClasses: ['a'], no_layout: true }, { no_layout: true }, { postClasses: ['a'] })
      ).toEqual({ metadata: undefined, conflicts: [] })
      expect(mergePostMetadata({ cache: 'deep', seo: 1 }, { cache: 'deep', seo: 1 }, { seo: 1 })).toEqual({
        metadata: { seo: 1 },
        conflicts: [],
      })
    })

    it('adds a key the editor introduced', () => {
      expect(mergePostMetadata(undefined, { no_layout: true }, { cache: 'hot' })).toEqual({
        metadata: { no_layout: true, cache: 'hot' },
        conflicts: [],
      })
    })

    it('compares deeply, so a re-created equal object counts as unchanged', () => {
      expect(
        mergePostMetadata({ seo: { title: 'X' } }, { seo: { title: 'X' } }, { seo: { title: 'Y' } })
      ).toEqual({ metadata: { seo: { title: 'Y' } }, conflicts: [] })
    })

    it('both sides making the same change is not a conflict', () => {
      expect(
        mergePostMetadata({ cache: 'deep', seo: { t: 1 } }, { cache: 'hot', seo: { t: 2 } }, { cache: 'hot', seo: { t: 2 } })
      ).toEqual({ metadata: { cache: 'hot', seo: { t: 2 } }, conflicts: [] })
    })

    it('returns undefined metadata for an empty result', () => {
      expect(mergePostMetadata(undefined, undefined, undefined)).toEqual({ metadata: undefined, conflicts: [] })
      expect(mergePostMetadata({ a: 1 }, {}, { a: 1 })).toEqual({ metadata: undefined, conflicts: [] })
    })

    it('does not read inherited properties for keys a side lacks', () => {
      expect(mergePostMetadata({ constructor: 1 }, { constructor: 1 }, {})).toEqual({ metadata: undefined, conflicts: [] })
    })
  })

  describe('postClasses changed on both sides', () => {
    const merge = (base: unknown, mine: unknown, theirs: unknown) =>
      mergePostMetadata(
        base === undefined ? {} : { postClasses: base as string[] },
        mine === undefined ? {} : { postClasses: mine as string[] },
        theirs === undefined ? {} : { postClasses: theirs as string[] }
      )

    it('keeps the ids both sides added (theirs first, then mine)', () => {
      expect(merge(['a'], ['a', 'c'], ['a', 'b'])).toEqual({ metadata: { postClasses: ['a', 'b', 'c'] }, conflicts: [] })
      expect(merge(undefined, ['c', 'd'], ['b'])).toEqual({ metadata: { postClasses: ['b', 'c', 'd'] }, conflicts: [] })
    })

    it('both sides removing different ids removes both', () => {
      expect(merge(['a', 'b', 'c'], ['a', 'c'], ['a', 'b'])).toEqual({ metadata: { postClasses: ['a'] }, conflicts: [] })
      // Everything removed deletes the key.
      expect(merge(['a', 'b'], ['a'], ['b'])).toEqual({ metadata: undefined, conflicts: [] })
      expect(merge(['a', 'b'], undefined, ['b'])).toEqual({ metadata: undefined, conflicts: [] })
    })

    it('one side adding while the other removes applies both', () => {
      expect(merge(['a', 'b'], ['a', 'b', 'c'], ['b'])).toEqual({ metadata: { postClasses: ['b', 'c'] }, conflicts: [] })
      expect(merge(['a', 'b'], ['b'], ['a', 'b', 'c'])).toEqual({ metadata: { postClasses: ['b', 'c'] }, conflicts: [] })
    })

    it('an id added on both sides is kept once', () => {
      expect(merge(['a'], ['a', 'x', 'c'], ['x', 'a', 'b'])).toEqual({
        metadata: { postClasses: ['x', 'a', 'b', 'c'] },
        conflicts: [],
      })
    })

    it('a removal on one side with the other side unchanged is applied', () => {
      expect(merge(['a', 'b'], ['a'], ['a', 'b'])).toEqual({ metadata: { postClasses: ['a'] }, conflicts: [] })
      expect(merge(['a', 'b'], ['a', 'b'], ['b'])).toEqual({ metadata: { postClasses: ['b'] }, conflicts: [] })
    })

    it('a non-clean value on any side is a conflict, with theirs as the placeholder', () => {
      expect(merge(['a'], ['a', 'c'], ['a', 'Bad Id'])).toEqual({
        metadata: { postClasses: ['a', 'Bad Id'] },
        conflicts: ['postClasses'],
      })
      expect(merge(['a'], ['c'], { plugin: 'x' })).toEqual({ metadata: { postClasses: { plugin: 'x' } }, conflicts: ['postClasses'] })
      expect(merge(['a', 'a'], ['b'], ['c'])).toEqual({ metadata: { postClasses: ['c'] }, conflicts: ['postClasses'] })
      expect(merge('a', ['b'], undefined)).toEqual({ metadata: undefined, conflicts: ['postClasses'] })
    })
  })

  describe('other keys changed on both sides', () => {
    it('are reported as conflicts, with theirs as the placeholder; other keys still merge', () => {
      expect(
        mergePostMetadata(
          { cache: 'deep', plugin_x: { n: 1 }, postClasses: ['a'] },
          { cache: 'hot', plugin_x: { n: 2 }, postClasses: ['a', 'c'] },
          { cache: 'auto', plugin_x: { n: 3 }, postClasses: ['a', 'b'] }
        )
      ).toEqual({
        metadata: { cache: 'auto', plugin_x: { n: 3 }, postClasses: ['a', 'b', 'c'] },
        conflicts: ['cache', 'plugin_x'],
      })
    })

    it('a key deleted on one side and changed on the other is a conflict', () => {
      expect(mergePostMetadata({ seo: 1 }, {}, { seo: 2 })).toEqual({ metadata: { seo: 2 }, conflicts: ['seo'] })
      expect(mergePostMetadata({ seo: 1 }, { seo: 2 }, {})).toEqual({ metadata: undefined, conflicts: ['seo'] })
    })
  })

  describe('an own `__proto__` key (as JSON.parse creates it)', () => {
    const md = (json: string) => JSON.parse(json) as Record<string, unknown>
    const isPlainPrototype = (x: unknown) => Object.getPrototypeOf(x) === Object.prototype

    it('unchanged on all sides: kept as an own key, prototype untouched', () => {
      const { metadata, conflicts } = mergePostMetadata(
        md('{"__proto__":{"x":1},"seo":1}'),
        md('{"__proto__":{"x":1},"seo":2}'),
        md('{"__proto__":{"x":1},"seo":1}')
      )
      expect(conflicts).toEqual([])
      expect(Object.prototype.hasOwnProperty.call(metadata, '__proto__')).toBe(true)
      expect(isPlainPrototype(metadata)).toBe(true)
      expect(JSON.stringify(metadata)).toBe('{"__proto__":{"x":1},"seo":2}')
      expect(({} as Record<string, unknown>).x).toBeUndefined()
    })

    it('changed on one side: that side wins, in either direction', () => {
      const mine = mergePostMetadata(md('{"__proto__":{"x":1}}'), md('{"__proto__":{"x":2}}'), md('{"__proto__":{"x":1}}'))
      expect(JSON.stringify(mine.metadata)).toBe('{"__proto__":{"x":2}}')
      expect(isPlainPrototype(mine.metadata)).toBe(true)
      const theirs = mergePostMetadata(md('{"__proto__":{"x":1}}'), md('{"__proto__":{"x":1}}'), md('{"__proto__":{"x":3}}'))
      expect(JSON.stringify(theirs.metadata)).toBe('{"__proto__":{"x":3}}')
      expect(isPlainPrototype(theirs.metadata)).toBe(true)
      // Only one side has it at all.
      const added = mergePostMetadata({}, {}, md('{"__proto__":"v"}'))
      expect(JSON.stringify(added.metadata)).toBe('{"__proto__":"v"}')
      expect(isPlainPrototype(added.metadata)).toBe(true)
    })

    it('changed differently on both sides: a conflict naming it, theirs as the placeholder', () => {
      const { metadata, conflicts } = mergePostMetadata(
        md('{"__proto__":{"x":1}}'),
        md('{"__proto__":{"x":2}}'),
        md('{"__proto__":{"x":3}}')
      )
      expect(conflicts).toEqual(['__proto__'])
      expect(JSON.stringify(metadata)).toBe('{"__proto__":{"x":3}}')
      expect(isPlainPrototype(metadata)).toBe(true)
    })
  })
})

describe('mergeStaticContent', () => {
  const v1: StaticContentGroup = {
    format: 'static',
    body: { entrypoint: 'index.html', files: ['index.html'], uploadedAt: 'v1' },
    files: { 'index.html': { size: 1, mimeType: 'text/html' } },
  }
  const v2: StaticContentGroup = {
    format: 'static',
    body: { entrypoint: 'index.html', files: ['app.js', 'index.html'], uploadedAt: 'v2' },
    files: { 'app.js': { size: 2, mimeType: 'text/javascript' }, 'index.html': { size: 3, mimeType: 'text/html' } },
  }
  const v3: StaticContentGroup = { ...v2, body: { ...(v2.body as object), uploadedAt: 'v3' } }
  // A deep copy, so equality is by value rather than identity.
  const copy = (g: StaticContentGroup): StaticContentGroup => JSON.parse(JSON.stringify(g))

  it('neither side changed the group: the stored group', () => {
    const theirs = copy(v1)
    expect(mergeStaticContent(v1, copy(v1), theirs)).toEqual({ value: theirs })
    expect(mergeStaticContent(v1, copy(v1), theirs).value).toBe(theirs)
  })

  it('only mine changed it: mine', () => {
    expect(mergeStaticContent(v1, v2, copy(v1)).value).toBe(v2)
  })

  it('only theirs changed it: theirs, so a stale manifest is never written', () => {
    expect(mergeStaticContent(v1, copy(v1), v2).value).toBe(v2)
  })

  it('both changed it the same way: mine (equal to theirs)', () => {
    expect(mergeStaticContent(v1, v2, copy(v2)).value).toBe(v2)
  })

  it('both changed it differently: a conflict', () => {
    expect(mergeStaticContent(v1, v2, v3)).toEqual({ conflict: true })
    // Only one field of the group differing is enough.
    expect(mergeStaticContent(v1, { ...v1, files: v2.files }, { ...v1, body: v2.body })).toEqual({ conflict: true })
  })

  it('a format switch to or from static on one side is taken as a whole', () => {
    const markdown: StaticContentGroup = { format: 'markdown', body: '# hi', files: undefined }
    // Theirs switched static -> markdown; mine left the group.
    expect(mergeStaticContent(v1, copy(v1), markdown).value).toBe(markdown)
    // Mine switched markdown -> static; theirs left the group.
    expect(mergeStaticContent(markdown, v1, copy(markdown)).value).toBe(v1)
    // Mine switched away from static while theirs uploaded another bundle.
    expect(mergeStaticContent(v1, markdown, v2)).toEqual({ conflict: true })
  })

  it('absent fields compare equal to absent fields', () => {
    const noFiles: StaticContentGroup = { format: 'static', body: v1.body, files: undefined }
    expect(mergeStaticContent(noFiles, { ...noFiles }, v2).value).toBe(v2)
  })
})
