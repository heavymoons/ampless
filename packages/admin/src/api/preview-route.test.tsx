import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import type { Post } from 'ampless'
import type { Admin } from '../index.js'
import { createPreviewRouteHandler } from './preview-route.js'

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'test-post-1',
    slug: 'test-post',
    title: 'Test Post',
    body: '<p>Hello world</p>',
    format: 'html',
    status: 'draft',
    publishedAt: null,
    tags: [],
    metadata: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Post
}

function makeAdmin(overrides: Partial<Admin> = {}): Admin {
  return {
    getServerSession: vi.fn().mockResolvedValue({ userId: 'u1', groups: ['editor'] }),
    isEditor: vi.fn().mockReturnValue(true),
    isAdmin: vi.fn().mockReturnValue(false),
    getAmpless: vi.fn().mockResolvedValue({
      renderBody: vi.fn().mockResolvedValue(null),
      publicPostScriptsForPage: vi.fn().mockResolvedValue(null),
      publicHeadForPreview: vi.fn().mockResolvedValue(null),
    }),
    loadThemeConfig: vi.fn().mockResolvedValue({
      cssVars: { '--color-primary': '#2563eb', '--color-background': '#ffffff' },
      activeTheme: 'blog',
      manifest: { fields: [] },
      values: {},
      colorScheme: 'auto',
    }),
    ...overrides,
  } as unknown as Admin
}

function makeRequest(body: unknown = makePost()): Request {
  return new Request('http://localhost/admin/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPreviewRouteHandler', () => {
  it('returns 403 when there is no editor session', async () => {
    const admin = makeAdmin({
      getServerSession: vi.fn().mockResolvedValue(null),
      isEditor: vi.fn().mockReturnValue(false),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 403 when the session is present but not an editor', async () => {
    const admin = makeAdmin({
      getServerSession: vi.fn().mockResolvedValue({ userId: 'u2', groups: [] }),
      isEditor: vi.fn().mockReturnValue(false),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 400 for malformed JSON body', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin)
    const req = new Request('http://localhost/admin/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json{{{',
    })
    const res = await handler(req)
    expect(res.status).toBe(400)
  })

  it('happy path: response starts with <!doctype html>', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.toLowerCase()).toMatch(/^<!doctype html>/)
  })

  it('happy path: response contains the base style block with id="ampless-preview-base"', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<style id="ampless-preview-base">')
  })

  it('happy path: response contains theme :root CSS custom properties', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    const text = await res.text()
    // renderThemeCss emits a :root block with the CSS vars
    expect(text).toContain(':root')
    expect(text).toContain('--color-primary')
  })

  it('happy path: body fragment and scripts are inside <body>', async () => {
    // Use null returns (renderBody / publicPostScriptsForPage both return
    // null → renderToStaticMarkup emits an empty string). We verify that
    // <body> is present and the <main> wrapper is inside it.
    const admin = makeAdmin({
      getAmpless: vi.fn().mockResolvedValue({
        renderBody: vi.fn().mockResolvedValue(null),
        publicPostScriptsForPage: vi.fn().mockResolvedValue(null),
        publicHeadForPreview: vi.fn().mockResolvedValue(null),
      }),
    })

    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    const text = await res.text()

    // <body> and </body> must be present
    const bodyTagIdx = text.indexOf('<body')
    const endBodyIdx = text.lastIndexOf('</body>')
    expect(bodyTagIdx).toBeGreaterThan(-1)
    expect(endBodyIdx).toBeGreaterThan(bodyTagIdx)

    // <main class="..."> wrapper (which holds the fragment) is inside <body>
    const bodyContent = text.slice(bodyTagIdx, endBodyIdx)
    expect(bodyContent).toMatch(/<main\b/)
  })

  it('happy path: Content-Type header is text/html', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  it('still returns a valid document when loadThemeConfig throws', async () => {
    const admin = makeAdmin({
      loadThemeConfig: vi.fn().mockRejectedValue(new Error('storage not configured')),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.toLowerCase()).toMatch(/^<!doctype html>/)
    // PREVIEW_BASE_CSS fallback is always present (id="ampless-preview-base")
    expect(text).toContain('<style id="ampless-preview-base">')
    // No :root vars because loadThemeConfig threw
    expect(text).not.toContain(':root')
  })

  it('default bodyClassName is applied to <main>', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<main class="prose prose-neutral dark:prose-invert max-w-none">')
  })

  it('custom bodyClassName overrides the default on <main>', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin, { bodyClassName: 'my-custom-wrapper' })
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<main class="my-custom-wrapper">')
    expect(text).not.toContain('prose prose-neutral')
  })

  describe('post classes', () => {
    const tagged = (ids: unknown) => ({
      'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids },
    })
    async function render(post: Post, options?: Parameters<typeof createPreviewRouteHandler>[1]) {
      const handler = createPreviewRouteHandler(makeAdmin(), options)
      const res = await handler(makeRequest(post))
      return res.text()
    }

    it('adds ampless-post--<id> to <main> for a tagged value', async () => {
      const text = await render(makePost({ format: 'tiptap', metadata: tagged(['wide', 'serif']) }))
      expect(text).toContain(
        '<main class="prose prose-neutral dark:prose-invert max-w-none ampless-post--wide ampless-post--serif">',
      )
    })

    it('is byte-identical without the tagged value (none, legacy postClasses, foreign value, invalid ids)', async () => {
      const baseline = await render(makePost({ metadata: undefined }))
      expect(baseline).toContain('<main class="prose prose-neutral dark:prose-invert max-w-none">')
      for (const metadata of [
        {},
        { postClasses: ['wide'] },
        { 'ampless:postClasses': ['wide'] },
        tagged(['Bad Id', '"><x']),
      ]) {
        expect(await render(makePost({ metadata }))).toBe(baseline)
      }
    })

    it('keeps a custom bodyClassName verbatim without classes and escapes it with classes', async () => {
      const base = 'a&b'
      expect(await render(makePost(), { bodyClassName: base })).toContain('<main class="a&b">')
      expect(
        await render(makePost({ format: 'markdown', metadata: tagged(['wide']) }), { bodyClassName: base }),
      ).toContain('<main class="a&amp;b ampless-post--wide">')
    })

    it('never applies classes to no_layout HTML or static drafts', async () => {
      const noLayout = await render(makePost({ format: 'html', metadata: { no_layout: true, ...tagged(['wide']) } }))
      expect(noLayout).not.toContain('ampless-post--')
      const staticPost = await render(makePost({ format: 'static', metadata: tagged(['wide']) }))
      expect(staticPost).not.toContain('ampless-post--')
    })
  })

  it('plugin publicHead scripts are injected into <head> of the preview document', async () => {
    // This is the core regression guard for the mermaid/highlight fix:
    // publicHeadForPreview returns a React element (a <script> tag) and
    // the handler must render it into the <head> section of the HTML.
    const admin = makeAdmin({
      getAmpless: vi.fn().mockResolvedValue({
        renderBody: vi.fn().mockResolvedValue(null),
        publicPostScriptsForPage: vi.fn().mockResolvedValue(null),
        publicHeadForPreview: vi.fn().mockResolvedValue(
          React.createElement('script', {
            id: 'ampless-mermaid',
            dangerouslySetInnerHTML: { __html: '/*mermaid-marker*/' },
          })
        ),
      }),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    expect(res.status).toBe(200)
    const text = await res.text()

    // The marker script must appear in the output
    expect(text).toContain('ampless-mermaid')
    expect(text).toContain('mermaid-marker')

    // It must appear within the <head> section (before </head>)
    const headEndIdx = text.indexOf('</head>')
    const markerIdx = text.indexOf('mermaid-marker')
    expect(headEndIdx).toBeGreaterThan(-1)
    expect(markerIdx).toBeGreaterThan(-1)
    expect(markerIdx).toBeLessThan(headEndIdx)
  })
})
