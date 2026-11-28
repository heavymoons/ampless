import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { canonicalJson, postVersion, withVersion, POST_VERSION_FIELDS } from './post-version.js'

const base: Post = {
  postId: 'p1',
  slug: 'weekly',
  title: 'Weekly',
  excerpt: 'Short',
  format: 'tiptap',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
  status: 'published',
  publishedAt: '2026-06-01T00:00:00.000Z',
  tags: ['a', 'b'],
  metadata: { cache: 'deep', 'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids: ['wide'] } },
  updatedAt: '2026-06-01T00:00:00.000Z',
}

describe('canonicalJson', () => {
  it('sorts object keys recursively, keeps array order, and omits undefined object values', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}')
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalJson([undefined])).toBe('[null]')
  })
})

describe('postVersion', () => {
  it('is a v1 sha256 token', () => {
    expect(postVersion(base)).toMatch(/^v1:[0-9a-f]{64}$/)
  })

  it('does not depend on object key order (top level or nested)', () => {
    const reordered = {
      updatedAt: base.updatedAt,
      metadata: { 'ampless:postClasses': { ids: ['wide'], version: 1, kind: 'ampless.post-classes' }, cache: 'deep' },
      tags: ['a', 'b'],
      publishedAt: base.publishedAt,
      status: base.status,
      body: { content: [{ content: [{ text: 'hi', type: 'text' }], type: 'paragraph' }], type: 'doc' },
      format: base.format,
      excerpt: base.excerpt,
      title: base.title,
      slug: base.slug,
      postId: base.postId,
    } as Post
    expect(postVersion(reordered)).toBe(postVersion(base))
  })

  it('changes when any covered field changes, updatedAt included', () => {
    const changes: Partial<Record<(typeof POST_VERSION_FIELDS)[number], unknown>> = {
      postId: 'p2',
      title: 'Other',
      slug: 'other',
      excerpt: undefined,
      format: 'markdown',
      body: { type: 'doc', content: [] },
      status: 'draft',
      publishedAt: undefined,
      tags: ['b', 'a'],
      metadata: { cache: 'deep', 'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids: ['wide'] }, plugin: 1 },
      updatedAt: '2026-06-01T00:00:00.001Z',
    }
    expect(Object.keys(changes).sort()).toEqual([...POST_VERSION_FIELDS].sort())
    const seen = new Set([postVersion(base)])
    for (const [field, value] of Object.entries(changes)) {
      const v = postVersion({ ...base, [field]: value } as Post)
      expect(seen.has(v), field).toBe(false)
      seen.add(v)
    }
  })

  it('ignores fields outside the covered set (e.g. a previous version)', () => {
    expect(postVersion({ ...base, version: 'v1:stale' } as Post)).toBe(postVersion(base))
  })
})

describe('withVersion', () => {
  it('adds version without changing the other fields', () => {
    const out = withVersion(base)
    expect(out).toEqual({ ...base, version: postVersion(base) })
  })
})
