import { describe, it, expect, vi } from 'vitest'
import type { Post } from 'ampless'

import { createRawRouteHandler } from './raw.js'
import type { Ampless } from '../index.js'

interface MockAmplessOpts {
  post: Post | null
  body?: string
}

function makeAmpless({ post, body = '<!doctype html>X' }: MockAmplessOpts): Ampless {
  return {
    outputs: {},
    getPublishedPost: vi.fn(async () => post),
    renderBody: vi.fn(() => body),
  } as unknown as Ampless
}

function makeRequest(url: string): Request {
  return new Request(url)
}

function makeCtx(params: { slug: string }) {
  return { params: Promise.resolve(params) }
}

const NO_LAYOUT_POST: Post = {
  postId: 'p1',
  slug: 'promo',
  title: 'Promo',
  format: 'html',
  body: '<!doctype html><html><body>Hi</body></html>',
  status: 'published',
  metadata: { no_layout: true },
}

// URLs in these tests use the public surface (`/<slug>`). The handler
// is invoked by Next.js after middleware rewrites `/<slug>` →
// `/raw/<slug>` internally — `request.url` surfaces the original
// public URL, which is what tests assert against.

describe('createRawRouteHandler', () => {
  it('returns the body verbatim with text/html for /<slug>', async () => {
    const handler = createRawRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST, body: '<!doctype html>BODY' }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe('<!doctype html>BODY')
  })

  it('does NOT set Cache-Control (middleware owns it)', async () => {
    const handler = createRawRouteHandler(
      makeAmpless({ post: NO_LAYOUT_POST, body: '<!doctype html>BODY' }),
    )
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.headers.get('Cache-Control')).toBeNull()
  })

  it('404s when the post is missing', async () => {
    const handler = createRawRouteHandler(makeAmpless({ post: null }))
    const res = await handler(
      makeRequest('https://x.example.com/missing'),
      makeCtx({ slug: 'missing' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for format=html without no_layout (middleware never rewrites these here)', async () => {
    const post: Post = { ...NO_LAYOUT_POST, metadata: {} }
    const handler = createRawRouteHandler(makeAmpless({ post }))
    const res = await handler(
      makeRequest('https://x.example.com/promo'),
      makeCtx({ slug: 'promo' }),
    )
    expect(res.status).toBe(404)
  })

  it('404s for tiptap / markdown / static posts (middleware bug guard)', async () => {
    for (const format of ['tiptap', 'markdown', 'static'] as const) {
      const post: Post = {
        ...NO_LAYOUT_POST,
        format,
        metadata: { no_layout: true },
      }
      const handler = createRawRouteHandler(makeAmpless({ post }))
      const res = await handler(
        makeRequest('https://x.example.com/promo'),
        makeCtx({ slug: 'promo' }),
      )
      expect(res.status).toBe(404)
    }
  })
})
