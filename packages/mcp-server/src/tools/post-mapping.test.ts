import { describe, it, expect } from 'vitest'
import { decodeBody, encodeBody, toCorePost } from './post-mapping.js'

describe('encodeBody / decodeBody', () => {
  it('round-trips structured body through JSON', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(decodeBody(encodeBody(body))).toEqual(body)
  })

  it('passes pre-encoded strings through encodeBody unchanged', () => {
    expect(encodeBody('# hello')).toBe('# hello')
  })

  it('decodeBody returns non-strings as-is', () => {
    const obj = { type: 'doc' }
    expect(decodeBody(obj)).toBe(obj)
  })

  it('decodeBody falls back to the raw string on invalid JSON', () => {
    expect(decodeBody('not json')).toBe('not json')
  })

  it('encodeBody serialises undefined / null as JSON null', () => {
    expect(encodeBody(undefined)).toBe('null')
    expect(encodeBody(null)).toBe('null')
  })
})

describe('toCorePost', () => {
  it('maps a fully populated row', () => {
    const row = {
      siteId: 'default',
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
      excerpt: 'Teaser',
      format: 'tiptap',
      body: '{"type":"doc","content":[]}',
      status: 'published',
      publishedAt: '2026-04-01T00:00:00.000Z',
      tags: ['intro', 'meta'],
    }
    expect(toCorePost(row)).toEqual({
      siteId: 'default',
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
      excerpt: 'Teaser',
      format: 'tiptap',
      body: { type: 'doc', content: [] },
      status: 'published',
      publishedAt: '2026-04-01T00:00:00.000Z',
      tags: ['intro', 'meta'],
    })
  })

  it('coerces missing format / status with safe defaults', () => {
    const row = {
      siteId: 'default',
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
    }
    const post = toCorePost(row)
    expect(post.format).toBe('markdown')
    expect(post.status).toBe('draft')
    expect(post.publishedAt).toBeUndefined()
    expect(post.tags).toEqual([])
  })

  it('strips null / non-string entries from tags', () => {
    const row = {
      siteId: 'default',
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
      tags: ['a', null, 'b'],
    }
    expect(toCorePost(row).tags).toEqual(['a', 'b'])
  })
})
