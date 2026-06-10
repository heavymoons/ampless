import { describe, it, expect } from 'vitest'
import { listPosts } from './list-posts.js'
import type { GraphqlClient } from './types.js'

interface MockCall {
  op: string
  vars: Record<string, unknown>
}

function makeGraphql(
  pages: Array<{ items: unknown[]; nextToken: string | null }>
): {
  graphql: GraphqlClient
  calls: MockCall[]
} {
  const calls: MockCall[] = []
  let pageIndex = 0
  return {
    graphql: {
      async query<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
        calls.push({ op: operation, vars: variables ?? {} })
        const page = pages[pageIndex++] ?? { items: [], nextToken: null }
        return { listPosts: page } as unknown as T
      },
    },
    calls,
  }
}

const ROW = {
  postId: 'post-1',
  slug: 'hello-world',
  title: 'Hello World',
  excerpt: 'An excerpt',
  format: 'markdown',
  status: 'published',
  publishedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
  tags: ['news'],
}

const ROW2 = {
  postId: 'post-2',
  slug: 'draft-note',
  title: '下書きメモ',
  excerpt: null,
  format: 'tiptap',
  status: 'draft',
  publishedAt: null,
  updatedAt: '2026-01-03T00:00:00.000Z',
  tags: ['ja'],
}

describe('list_posts query string', () => {
  it('does NOT include body or metadata in the issued query', async () => {
    const g = makeGraphql([{ items: [ROW], nextToken: null }])
    await listPosts(g.graphql, {})
    const query = g.calls[0]!.op
    expect(query).not.toMatch(/\bbody\b/)
    expect(query).not.toMatch(/\bmetadata\b/)
  })

  it('includes updatedAt in the issued query', async () => {
    const g = makeGraphql([{ items: [ROW], nextToken: null }])
    await listPosts(g.graphql, {})
    const query = g.calls[0]!.op
    expect(query).toContain('updatedAt')
  })
})

describe('list_posts paging', () => {
  it('follows nextToken until exhausted, combining all rows', async () => {
    // First page returns ROW + a nextToken; second page returns ROW2 + null
    const g = makeGraphql([
      { items: [ROW], nextToken: 'cursor-abc' },
      { items: [ROW2], nextToken: null },
    ])
    const result = await listPosts(g.graphql, {})
    expect(g.calls).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.posts.map((p) => p.postId)).toContain('post-1')
    expect(result.posts.map((p) => p.postId)).toContain('post-2')
  })

  it('passes nextToken from first response into second query', async () => {
    const g = makeGraphql([
      { items: [ROW], nextToken: 'tok-xyz' },
      { items: [], nextToken: null },
    ])
    await listPosts(g.graphql, {})
    expect(g.calls[1]!.vars.nextToken).toBe('tok-xyz')
  })
})

describe('list_posts status push-down', () => {
  it('sends status filter as GraphQL filter when status is "published"', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    await listPosts(g.graphql, { status: 'published' })
    expect(g.calls[0]!.vars.filter).toEqual({ status: { eq: 'published' } })
  })

  it('sends status filter for "draft"', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    await listPosts(g.graphql, { status: 'draft' })
    expect(g.calls[0]!.vars.filter).toEqual({ status: { eq: 'draft' } })
  })

  it('sends no filter when status is "all"', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    await listPosts(g.graphql, { status: 'all' })
    expect(g.calls[0]!.vars.filter).toBeUndefined()
  })
})

describe('list_posts filter / sort / offset / limit / total', () => {
  it('returns defaults: sort=updated-desc, limit=20, offset=0, total', async () => {
    const g = makeGraphql([{ items: [ROW, ROW2], nextToken: null }])
    const result = await listPosts(g.graphql, {})
    expect(result.limit).toBe(20)
    expect(result.offset).toBe(0)
    expect(result.total).toBe(2)
    // updated-desc: ROW (2026-01-05) first, ROW2 (2026-01-03) second
    expect(result.posts[0]!.postId).toBe('post-1')
    expect(result.posts[1]!.postId).toBe('post-2')
  })

  it('applies query substring filter in-process', async () => {
    const g = makeGraphql([{ items: [ROW, ROW2], nextToken: null }])
    const result = await listPosts(g.graphql, { query: 'hello' })
    expect(result.total).toBe(1)
    expect(result.posts[0]!.postId).toBe('post-1')
  })

  it('applies tag filter in-process', async () => {
    const g = makeGraphql([{ items: [ROW, ROW2], nextToken: null }])
    const result = await listPosts(g.graphql, { tag: 'ja' })
    expect(result.total).toBe(1)
    expect(result.posts[0]!.postId).toBe('post-2')
  })

  it('applies sort title-asc in-process', async () => {
    const g = makeGraphql([{ items: [ROW, ROW2], nextToken: null }])
    const result = await listPosts(g.graphql, { sort: 'title-asc' })
    // Alpha sort: 'Hello World' < '下書きメモ' in localeCompare
    expect(result.posts[0]!.postId).toBe('post-1')
  })

  it('applies offset and limit for pagination', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...ROW,
      postId: `post-${i + 1}`,
      slug: `post-${i + 1}`,
      title: `Post ${i + 1}`,
      updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
    }))
    const g = makeGraphql([{ items, nextToken: null }])
    const result = await listPosts(g.graphql, { limit: 2, offset: 1, sort: 'title-asc' })
    expect(result.total).toBe(5)
    expect(result.posts).toHaveLength(2)
    expect(result.offset).toBe(1)
    expect(result.limit).toBe(2)
    // title-asc: Post 1, Post 2, Post 3, Post 4, Post 5 — offset 1 = Post 2, Post 3
    expect(result.posts[0]!.title).toBe('Post 2')
    expect(result.posts[1]!.title).toBe('Post 3')
  })
})

describe('list_posts clamping and normalisation', () => {
  it('clamps limit > 100 to 100', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    const result = await listPosts(g.graphql, { limit: 10000 })
    expect(result.limit).toBe(100)
  })

  it('clamps limit < 1 to 1', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    const result = await listPosts(g.graphql, { limit: 0 })
    expect(result.limit).toBe(1)
  })

  it('clamps negative offset to 0', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    const result = await listPosts(g.graphql, { offset: -1 })
    expect(result.offset).toBe(0)
  })

  it('truncates fractional limit', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    const result = await listPosts(g.graphql, { limit: 5.9 })
    expect(result.limit).toBe(5)
  })

  it('truncates fractional offset', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    const result = await listPosts(g.graphql, { offset: 2.7 })
    expect(result.offset).toBe(2)
  })
})

describe('list_posts response shape', () => {
  it('format is present on each post summary', async () => {
    const g = makeGraphql([{ items: [ROW], nextToken: null }])
    const result = await listPosts(g.graphql, {})
    expect(result.posts[0]!.format).toBe('markdown')
  })

  it('does NOT include body or metadata in post summaries', async () => {
    const g = makeGraphql([{ items: [ROW], nextToken: null }])
    const result = await listPosts(g.graphql, {})
    const post = result.posts[0]! as unknown as Record<string, unknown>
    expect(post['body']).toBeUndefined()
    expect(post['metadata']).toBeUndefined()
  })

  it('returns empty posts with total=0 when no items', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    const result = await listPosts(g.graphql, {})
    expect(result.posts).toEqual([])
    expect(result.total).toBe(0)
  })
})
