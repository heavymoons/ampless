import { describe, expect, it } from 'vitest'
import type { ContentEventPayload } from 'ampless'
import { computePostTagDiff } from './posttag-sync.js'

function published(opts: Partial<ContentEventPayload> = {}): ContentEventPayload {
  return {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    status: 'published',
    publishedAt: '2026-05-01T00:00:00.000Z',
    tags: ['news', 'tech'],
    ...opts,
  }
}

describe('computePostTagDiff', () => {
  it('INSERT of a published post → put for each tag, no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published(),
    })
    expect(deletes).toEqual([])
    expect(puts).toHaveLength(2)
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
    for (const p of puts) {
      expect(p.publishedAtPostId).toBe('2026-05-01T00:00:00.000Z#p1')
      expect(p.postId).toBe('p1')
      expect(p.slug).toBe('hello')
    }
  })

  it('INSERT of a draft → no puts, no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published({ status: 'draft' }),
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('published post without publishedAt → no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published({ publishedAt: undefined }),
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('published post with no tags → no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published({ tags: [] }),
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('MODIFY: remove a tag → delete for the removed tag, puts for the remaining', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news', 'tech'] }),
      next: published({ tags: ['news'] }),
    })
    expect(deletes).toEqual([
      { tag: 'tech', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
    ])
    expect(puts.map((p) => p.tag)).toEqual(['news'])
  })

  it('MODIFY: add a tag → puts for both tags (new + carry-over), no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news'] }),
      next: published({ tags: ['news', 'tech'] }),
    })
    expect(deletes).toEqual([])
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
  })

  it('MODIFY: title-only change → puts for every tag, no deletes (upsert behaviour)', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ title: 'Old' }),
      next: published({ title: 'New' }),
    })
    expect(deletes).toEqual([])
    expect(puts).toHaveLength(2)
    for (const p of puts) {
      expect(p.title).toBe('New')
    }
  })

  it('MODIFY: publishedAt change → deletes for old key, puts for new key', () => {
    const oldStamp = '2026-05-01T00:00:00.000Z'
    const newStamp = '2026-06-01T00:00:00.000Z'
    const { deletes, puts } = computePostTagDiff({
      previous: published({ publishedAt: oldStamp, tags: ['news'] }),
      next: published({ publishedAt: newStamp, tags: ['news'] }),
    })
    expect(deletes).toEqual([
      { tag: 'news', publishedAtPostId: `${oldStamp}#p1` },
    ])
    expect(puts).toHaveLength(1)
    expect(puts[0]!.publishedAtPostId).toBe(`${newStamp}#p1`)
  })

  it('MODIFY: published → draft (unpublish) → deletes for every previous tag, no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news', 'tech'] }),
      next: published({ status: 'draft' }),
    })
    expect(deletes).toHaveLength(2)
    expect(deletes.map((d) => d.tag).sort()).toEqual(['news', 'tech'])
    expect(puts).toEqual([])
  })

  it('MODIFY: draft → published → puts for every new tag, no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ status: 'draft' }),
      next: published({ tags: ['news', 'tech'] }),
    })
    expect(deletes).toEqual([])
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
  })

  it('REMOVE of a published post → deletes for every previous tag, no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news', 'tech'] }),
      next: null,
    })
    expect(deletes).toHaveLength(2)
    expect(deletes.map((d) => d.tag).sort()).toEqual(['news', 'tech'])
    expect(puts).toEqual([])
  })

  it('REMOVE of a draft → no deletes, no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ status: 'draft' }),
      next: null,
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('null tag entries / empty-string tags are filtered out', () => {
    const { puts } = computePostTagDiff({
      previous: null,
      next: published({ tags: ['news', '', 'tech'] }),
    })
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
  })
})
