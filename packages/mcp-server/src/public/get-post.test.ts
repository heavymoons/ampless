import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { getPostTool } from './get-post.js'
import type { PublicToolContext } from './types.js'

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    format: 'markdown',
    body: { raw: 'secret-body' },
    status: 'published',
    metadata: { no_layout: true },
    excerpt: 'An excerpt',
    tags: ['news'],
    publishedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

function makeCtx(opts: {
  post?: Post | null
  markdown?: string | ((post: Post, o?: { frontmatter?: boolean }) => string)
}): {
  ctx: PublicToolContext
  mdCalls: { frontmatter?: boolean }[]
} {
  const mdCalls: { frontmatter?: boolean }[] = []
  return {
    mdCalls,
    ctx: {
      listPublishedPosts: async () => ({ items: [], nextToken: null }),
      getPublishedPost: async () => (opts.post === undefined ? makePost() : opts.post),
      postToMarkdown: async (post, o) => {
        mdCalls.push({ frontmatter: o?.frontmatter })
        if (typeof opts.markdown === 'function') return opts.markdown(post, o)
        return opts.markdown ?? '# body'
      },
    },
  }
}

describe('public get_post', () => {
  it('returns summary + markdown for a found post (frontmatter defaults to true)', async () => {
    const { ctx, mdCalls } = makeCtx({ markdown: '# Hello\n\nbody' })
    const res = (await getPostTool.handler({ slug: 'hello' }, ctx)) as Record<string, unknown>
    expect(mdCalls[0]!.frontmatter).toBe(true)
    expect(res.markdown).toBe('# Hello\n\nbody')
    expect(res.truncated).toBe(false)
    expect(res.slug).toBe('hello')
    expect(res.title).toBe('Hello')
  })

  it('passes frontmatter: false through and ignores non-boolean frontmatter', async () => {
    const explicit = makeCtx({})
    await getPostTool.handler({ slug: 'hello', frontmatter: false }, explicit.ctx)
    expect(explicit.mdCalls[0]!.frontmatter).toBe(false)

    const bad = makeCtx({})
    await getPostTool.handler({ slug: 'hello', frontmatter: 'yes' }, bad.ctx)
    expect(bad.mdCalls[0]!.frontmatter).toBe(true) // non-boolean → default true
  })

  it('throws a not-found error when no published post matches', async () => {
    const { ctx } = makeCtx({ post: null })
    await expect(getPostTool.handler({ slug: 'missing' }, ctx)).rejects.toThrow(/No published post/)
  })

  it('truncates markdown longer than 100k chars and flags truncated: true', async () => {
    const long = 'x'.repeat(100_001)
    const { ctx } = makeCtx({ markdown: long })
    const res = (await getPostTool.handler({ slug: 'hello' }, ctx)) as {
      markdown: string
      truncated: boolean
    }
    expect(res.markdown.length).toBe(100_000)
    expect(res.truncated).toBe(true)
  })

  it('rejects a non-string slug', async () => {
    const { ctx } = makeCtx({})
    await expect(getPostTool.handler({ slug: 42 }, ctx)).rejects.toThrow(/slug/)
  })

  it('rejects an overlong slug (> 512 chars)', async () => {
    const { ctx } = makeCtx({})
    await expect(getPostTool.handler({ slug: 'a'.repeat(513) }, ctx)).rejects.toThrow(/slug/)
  })

  it('field allowlist: never leaks postId / status / metadata / body', async () => {
    const { ctx } = makeCtx({ markdown: '# body' })
    const res = await getPostTool.handler({ slug: 'hello' }, ctx)
    const json = JSON.stringify(res)
    expect(json).not.toContain('postId')
    expect(json).not.toContain('status')
    expect(json).not.toContain('metadata')
    expect(json).not.toContain('secret-body')
    // `body` must not appear as a key (markdown is the only body surface).
    expect(json).not.toMatch(/"body"/)
  })
})
