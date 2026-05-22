import { describe, it, expect } from 'vitest'
import { toCorePost } from './post-mapping.js'

// AWSJSON encode / decode tests live in `ampless/src/awsjson.test.ts`
// since the helpers are now provided by `ampless` (`encodeAwsJson` /
// `decodeAwsJson`). Only the Post-shape mapping is tested here.

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
