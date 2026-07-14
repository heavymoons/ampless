import { describe, it, expect, vi } from 'vitest'
import type { Config, Post } from 'ampless'

import { createMarkdownRouteHandler } from './md.js'
import type { Ampless } from '../index.js'

interface MockAmplessOpts {
  post: Post | null
  markdown?: string
  cmsConfig?: Config
}

const BASE_CONFIG: Config = { site: { name: 'X', url: 'https://x' } }

function makeAmpless({
  post,
  markdown = '# Title\n\nBody',
  cmsConfig = BASE_CONFIG,
}: MockAmplessOpts): Ampless {
  return {
    outputs: {},
    getPublishedPost: vi.fn(async () => post),
    postToMarkdown: vi.fn(async () => markdown),
    cmsConfig,
  } as unknown as Ampless
}

function makeRequest(url: string): Request {
  return new Request(url)
}

function makeCtx(params: { slug: string }) {
  return { params: Promise.resolve(params) }
}

const POST: Post = {
  postId: 'p1',
  slug: 'hello',
  title: 'Hello',
  format: 'markdown',
  body: 'Hello body',
  status: 'published',
  metadata: {},
}

// URLs in these tests use the public surface (`/<slug>.md`). The
// handler is invoked by Next.js after middleware rewrites
// `/<slug>.md` → `/md/<slug>` internally — `request.url` surfaces
// the original public URL, which is what tests assert against.

describe('createMarkdownRouteHandler', () => {
  it('returns postToMarkdown output with text/markdown for /<slug>.md', async () => {
    const ampless = makeAmpless({ post: POST, markdown: '# Hello\n\nHello body' })
    const handler = createMarkdownRouteHandler(ampless)
    const res = await handler(
      makeRequest('https://x.example.com/hello.md'),
      makeCtx({ slug: 'hello' }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(await res.text()).toBe('# Hello\n\nHello body')
    expect(ampless.getPublishedPost).toHaveBeenCalledWith('hello')
  })

  it('does NOT set Cache-Control (middleware owns it)', async () => {
    const ampless = makeAmpless({ post: POST })
    const handler = createMarkdownRouteHandler(ampless)
    const res = await handler(
      makeRequest('https://x.example.com/hello.md'),
      makeCtx({ slug: 'hello' }),
    )
    expect(res.headers.get('Cache-Control')).toBeNull()
  })

  it('404s when the post is missing', async () => {
    const ampless = makeAmpless({ post: null })
    const handler = createMarkdownRouteHandler(ampless)
    const res = await handler(
      makeRequest('https://x.example.com/missing.md'),
      makeCtx({ slug: 'missing' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s when the post is a draft (getPublishedPost returns null)', async () => {
    // getPublishedPost is the published-only projection — a draft
    // post can't reach this handler regardless of the requested slug.
    const ampless = makeAmpless({ post: null })
    const handler = createMarkdownRouteHandler(ampless)
    const res = await handler(
      makeRequest('https://x.example.com/draft.md'),
      makeCtx({ slug: 'draft' }),
    )
    expect(res.status).toBe(404)
  })

  it("404s when cms.config.ai.markdownRoutes is false", async () => {
    const ampless = makeAmpless({
      post: POST,
      cmsConfig: { ...BASE_CONFIG, ai: { markdownRoutes: false } },
    })
    const handler = createMarkdownRouteHandler(ampless)
    const res = await handler(
      makeRequest('https://x.example.com/hello.md'),
      makeCtx({ slug: 'hello' }),
    )
    expect(res.status).toBe(404)
    expect(ampless.getPublishedPost).not.toHaveBeenCalled()
  })

  it('serves normally when cms.config.ai.markdownRoutes is true or unset', async () => {
    for (const cmsConfig of [
      BASE_CONFIG,
      { ...BASE_CONFIG, ai: { markdownRoutes: true } },
    ]) {
      const ampless = makeAmpless({ post: POST, cmsConfig })
      const handler = createMarkdownRouteHandler(ampless)
      const res = await handler(
        makeRequest('https://x.example.com/hello.md'),
        makeCtx({ slug: 'hello' }),
      )
      expect(res.status).toBe(200)
    }
  })

  it('strips a defensive trailing .md from the slug param (direct /md/<slug>.md hit)', async () => {
    const ampless = makeAmpless({ post: POST })
    const handler = createMarkdownRouteHandler(ampless)
    await handler(
      makeRequest('https://x.example.com/md/hello.md'),
      makeCtx({ slug: 'hello.md' }),
    )
    expect(ampless.getPublishedPost).toHaveBeenCalledWith('hello')
  })

  it('serves any post format (tiptap / markdown / html / static)', async () => {
    for (const format of ['tiptap', 'markdown', 'html', 'static'] as const) {
      const post: Post = { ...POST, format }
      const ampless = makeAmpless({ post })
      const handler = createMarkdownRouteHandler(ampless)
      const res = await handler(
        makeRequest('https://x.example.com/hello.md'),
        makeCtx({ slug: 'hello' }),
      )
      expect(res.status).toBe(200)
    }
  })
})
