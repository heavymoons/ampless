import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { publicTools } from './index.js'
import type { PublicToolContext } from './types.js'
import { dispatchJsonRpc } from '../jsonrpc/index.js'

// Proves the public registry runs end-to-end through the SHARED
// dispatch (not the global admin registry): initialize → tools/list →
// tools/call for all four public tools, over publicTools + a fake ctx.

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    slug: 'hello-world',
    title: 'Hello World',
    format: 'markdown',
    body: { raw: 'body' },
    status: 'published',
    tags: ['news', 'ts'],
    excerpt: 'An excerpt',
    ...overrides,
  }
}

const fakeCtx: PublicToolContext = {
  listPublishedPosts: async () => ({ items: [makePost()], nextToken: null }),
  getPublishedPost: async (slug) => (slug === 'hello-world' ? makePost() : null),
  postToMarkdown: async () => '# Hello World\n\nbody',
}

const opts = {
  tools: publicTools,
  getContext: () => fakeCtx,
  serverInfo: { name: 'ampless-public-mcp', version: '0' },
}

function parseToolResult(res: unknown): unknown {
  const result = (res as { result: { content: { text: string }[] } }).result
  return JSON.parse(result.content[0]!.text)
}

describe('publicTools end-to-end via dispatchJsonRpc', () => {
  it('initialize negotiates a protocol version', async () => {
    const res = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      opts
    )
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26')
  })

  it('tools/list lists exactly the 4 public tools, all read-only', async () => {
    const res = await dispatchJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, opts)
    const tools = (res?.result as { tools: { name: string; annotations: Record<string, boolean> }[] }).tools
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_post', 'list_posts', 'list_tags', 'search_posts'].sort()
    )
    for (const t of tools) {
      expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
    }
  })

  it('tools/call list_posts', async () => {
    const res = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_posts', arguments: {} } },
      opts
    )
    const payload = parseToolResult(res) as { posts: { slug: string }[]; nextCursor: string | null }
    expect(payload.posts[0]!.slug).toBe('hello-world')
    expect(payload.nextCursor).toBeNull()
  })

  it('tools/call get_post', async () => {
    const res = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_post', arguments: { slug: 'hello-world' } },
      },
      opts
    )
    const payload = parseToolResult(res) as { markdown: string; truncated: boolean }
    expect(payload.markdown).toContain('Hello World')
    expect(payload.truncated).toBe(false)
  })

  it('tools/call search_posts', async () => {
    const res = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'search_posts', arguments: { query: 'hello' } },
      },
      opts
    )
    const payload = parseToolResult(res) as { posts: { slug: string }[]; scanTruncated: boolean }
    expect(payload.posts[0]!.slug).toBe('hello-world')
    expect(payload.scanTruncated).toBe(false)
  })

  it('tools/call list_tags', async () => {
    const res = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_tags', arguments: {} } },
      opts
    )
    const payload = parseToolResult(res) as { tags: { tag: string; count: number }[] }
    expect(payload.tags.map((t) => t.tag).sort()).toEqual(['news', 'ts'])
  })

  it('get_post not-found surfaces as an isError tool result', async () => {
    const res = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_post', arguments: { slug: 'missing' } },
      },
      opts
    )
    const result = (res as { result: { isError?: boolean; content: { text: string }[] } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('No published post found for the requested slug.')
  })
})
