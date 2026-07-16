import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { listPostsTool } from './list-posts.js'
import type { PublicToolContext } from './types.js'

let seq = 0
function makePost(overrides: Partial<Post> = {}): Post {
  seq += 1
  return {
    postId: `p${seq}`,
    slug: `post-${seq}`,
    title: `Post ${seq}`,
    format: 'markdown',
    body: { secret: 'body-content' },
    status: 'published',
    metadata: { no_layout: true },
    ...overrides,
  }
}

interface ListCall {
  limit?: number
  nextToken?: string
}

function makeCtx(page: { items: Post[]; nextToken: string | null }): {
  ctx: PublicToolContext
  calls: ListCall[]
} {
  const calls: ListCall[] = []
  return {
    calls,
    ctx: {
      listPublishedPosts: async (opts) => {
        calls.push({ limit: opts.limit, nextToken: opts.nextToken })
        return page
      },
      getPublishedPost: async () => null,
      postToMarkdown: async () => '',
    },
  }
}

describe('public list_posts', () => {
  it('clamps limit into 1..50 and defaults to 20', async () => {
    const big = makeCtx({ items: [], nextToken: null })
    await listPostsTool.handler({ limit: 100 }, big.ctx)
    expect(big.calls[0]!.limit).toBe(50)

    const small = makeCtx({ items: [], nextToken: null })
    await listPostsTool.handler({ limit: 0 }, small.ctx)
    expect(small.calls[0]!.limit).toBe(1)

    const def = makeCtx({ items: [], nextToken: null })
    await listPostsTool.handler({}, def.ctx)
    expect(def.calls[0]!.limit).toBe(20)
  })

  it('passes the cursor through and returns nextCursor opaquely (single page, no scan)', async () => {
    const { ctx, calls } = makeCtx({ items: [makePost()], nextToken: 'next-abc' })
    const res = (await listPostsTool.handler({ cursor: 'cur-123' }, ctx)) as {
      posts: unknown[]
      nextCursor: string | null
    }
    expect(calls.length).toBe(1) // one page read, no walk
    expect(calls[0]!.nextToken).toBe('cur-123')
    expect(res.nextCursor).toBe('next-abc')
  })

  it('returns null nextCursor when the backend is exhausted', async () => {
    const { ctx } = makeCtx({ items: [makePost()], nextToken: null })
    const res = (await listPostsTool.handler({}, ctx)) as { nextCursor: string | null }
    expect(res.nextCursor).toBeNull()
  })

  it('rejects a non-string cursor', async () => {
    const { ctx } = makeCtx({ items: [], nextToken: null })
    await expect(listPostsTool.handler({ cursor: 123 }, ctx)).rejects.toThrow(/cursor/)
  })

  it('rejects an overlong cursor (> 4096 chars)', async () => {
    const { ctx } = makeCtx({ items: [], nextToken: null })
    await expect(listPostsTool.handler({ cursor: 'x'.repeat(4097) }, ctx)).rejects.toThrow(/cursor/)
  })

  it('field allowlist: never leaks postId / status / metadata / body', async () => {
    const { ctx } = makeCtx({
      items: [makePost({ slug: 'a', title: 'A', excerpt: 'e', tags: ['t'], publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' })],
      nextToken: null,
    })
    const res = await listPostsTool.handler({}, ctx)
    const json = JSON.stringify(res)
    expect(json).not.toContain('postId')
    expect(json).not.toContain('status')
    expect(json).not.toContain('metadata')
    expect(json).not.toContain('body')
    expect(json).not.toContain('body-content')
    // Allowlisted fields are present.
    const post = (res as { posts: Record<string, unknown>[] }).posts[0]!
    expect(post).toEqual({
      slug: 'a',
      title: 'A',
      excerpt: 'e',
      tags: ['t'],
      publishedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      format: 'markdown',
    })
  })
})
