import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { searchPostsTool } from './search-posts.js'
import type { PublicToolContext } from './types.js'

let seq = 0
function makePost(overrides: Partial<Post> = {}): Post {
  seq += 1
  return {
    postId: `p${seq}`,
    slug: `post-${seq}`,
    title: `Post ${seq}`,
    format: 'markdown',
    body: { raw: 'secret' },
    status: 'published',
    ...overrides,
  }
}

type ListFn = (opts: { limit?: number; nextToken?: string }) => Promise<{
  items: Post[]
  nextToken: string | null
}>

function ctxFromList(list: ListFn): PublicToolContext {
  return {
    listPublishedPosts: list,
    getPublishedPost: async () => null,
    postToMarkdown: async () => '',
  }
}

// A ctx that serves `pages` in call order (a single page = single call).
function ctxFromPages(pages: { items: Post[]; nextToken: string | null }[]): {
  ctx: PublicToolContext
  callCount: () => number
} {
  let i = 0
  return {
    callCount: () => i,
    ctx: ctxFromList(async () => {
      const page = pages[i] ?? { items: [], nextToken: null }
      i += 1
      return page
    }),
  }
}

describe('public search_posts', () => {
  it('matches case-insensitively across title / slug / tags / excerpt (not body)', async () => {
    const byTitle = makePost({ title: 'The Needle Sits Here', slug: 's1' })
    const bySlug = makePost({ title: 'nope', slug: 'a-needle-slug' })
    const byTag = makePost({ title: 'nope', slug: 's3', tags: ['NeEdLe'] })
    const byExcerpt = makePost({ title: 'nope', slug: 's4', excerpt: 'buried needle inside' })
    const bodyOnly = makePost({ title: 'nope', slug: 's5', body: { raw: 'needle in body only' } })
    const { ctx } = ctxFromPages([
      { items: [byTitle, bySlug, byTag, byExcerpt, bodyOnly], nextToken: null },
    ])
    const res = (await searchPostsTool.handler({ query: 'NEEDLE' }, ctx)) as {
      posts: { slug: string }[]
      scanTruncated: boolean
    }
    const slugs = res.posts.map((p) => p.slug).sort()
    expect(slugs).toEqual(['a-needle-slug', 's1', 's3', 's4'])
    expect(slugs).not.toContain('s5') // body is not searched
    expect(res.scanTruncated).toBe(false)
  })

  it('clamps an overlong query to 256 chars before matching', async () => {
    const title256 = 'a'.repeat(256)
    const post = makePost({ title: title256, slug: 'clamp' })
    const { ctx } = ctxFromPages([{ items: [post], nextToken: null }])
    // 300-char query; only survives as a match if it was clamped to 256.
    const res = (await searchPostsTool.handler({ query: 'a'.repeat(300) }, ctx)) as {
      posts: { slug: string }[]
    }
    expect(res.posts.map((p) => p.slug)).toEqual(['clamp'])
  })

  it('respects the result limit (1..20, default 10)', async () => {
    const posts = Array.from({ length: 15 }, () => makePost({ title: 'match me' }))
    const { ctx } = ctxFromPages([{ items: posts, nextToken: null }])
    const res = (await searchPostsTool.handler({ query: 'match', limit: 3 }, ctx)) as {
      posts: unknown[]
    }
    expect(res.posts.length).toBe(3)
  })

  it('rejects a non-string query and an empty / whitespace query', async () => {
    const { ctx } = ctxFromPages([{ items: [], nextToken: null }])
    await expect(searchPostsTool.handler({ query: 5 }, ctx)).rejects.toThrow(/query/)
    await expect(searchPostsTool.handler({ query: '   ' }, ctx)).rejects.toThrow(/query/)
  })

  it('bounds the scan at maxPages = 5 and reports scanTruncated', async () => {
    // Infinite paging: 1 item + a fresh token every call. Only the
    // public 5-page cap can stop this.
    let calls = 0
    const ctx = ctxFromList(async () => {
      calls += 1
      return { items: [makePost({ title: 'no-match-here' })], nextToken: `tok-${calls}` }
    })
    const res = (await searchPostsTool.handler({ query: 'needle' }, ctx)) as {
      scanTruncated: boolean
    }
    expect(calls).toBe(5)
    expect(res.scanTruncated).toBe(true)
  })

  it('field allowlist: never leaks postId / status / metadata / body', async () => {
    const post = makePost({ title: 'findme', slug: 'f', metadata: { no_layout: true } })
    const { ctx } = ctxFromPages([{ items: [post], nextToken: null }])
    const res = await searchPostsTool.handler({ query: 'findme' }, ctx)
    const json = JSON.stringify(res)
    expect(json).not.toContain('postId')
    expect(json).not.toContain('metadata')
    expect(json).not.toMatch(/"body"/)
    expect(json).not.toContain('secret')
  })
})
