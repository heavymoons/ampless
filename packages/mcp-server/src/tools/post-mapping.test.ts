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

  it('decodes metadata as AWSJSON (string round-trip)', () => {
    const row = {
      siteId: 'default',
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
      metadata: '{"no_layout":true,"author":"alice"}',
    }
    expect(toCorePost(row).metadata).toEqual({ no_layout: true, author: 'alice' })
  })

  it('passes a native-object metadata through (Amplify-stored Map)', () => {
    // Mirrors the KvStore shape quirk in mcp-handler — Amplify's
    // generated mutation resolver sometimes stores AWSJSON as native
    // DDB types, so the read-back is already an object. The decoder
    // should pass it through without re-parsing.
    const row = {
      siteId: 'default',
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
      metadata: { no_layout: true },
    }
    expect(toCorePost(row).metadata).toEqual({ no_layout: true })
  })

  it('returns undefined when metadata is missing or null', () => {
    expect(
      toCorePost({ siteId: 'd', postId: 'p', slug: 's', title: 't' }).metadata
    ).toBeUndefined()
    expect(
      toCorePost({ siteId: 'd', postId: 'p', slug: 's', title: 't', metadata: null }).metadata
    ).toBeUndefined()
  })
})
