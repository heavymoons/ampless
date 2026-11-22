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
    expect(text).toContain('<main id="post-body" class="prose prose-neutral dark:prose-invert max-w-none">')
  })

  it('custom bodyClassName overrides the default on <main>', async () => {
    const admin = makeAdmin()
    const handler = createPreviewRouteHandler(admin, { bodyClassName: 'my-custom-wrapper' })
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<main id="post-body" class="my-custom-wrapper">')
    expect(text).not.toContain('prose prose-neutral')
  })

  it('appends the draft metadata.postClasses as ampless-post--<id> on <main>', async () => {
    const handler = createPreviewRouteHandler(makeAdmin())
    const res = await handler(makeRequest(makePost({ metadata: { postClasses: ['wide', 'serif', 'wide'] } })))
    const text = await res.text()
    expect(text).toContain(
      '<main id="post-body" class="prose prose-neutral dark:prose-invert max-w-none ampless-post--wide ampless-post--serif">',
    )
  })

  it('drops invalid postClasses ids so they cannot break out of the class attribute', async () => {
    const handler = createPreviewRouteHandler(makeAdmin())
    const res = await handler(
      makeRequest(makePost({ metadata: { postClasses: ['x" onmouseover="alert(1)', '<b>', 'ok'] } })),
    )
    const text = await res.text()
    expect(text).toContain('<main id="post-body" class="prose prose-neutral dark:prose-invert max-w-none ampless-post--ok">')
    expect(text).not.toContain('onmouseover')
  })

  it('uses the active theme manifest postBody.className as the #post-body base', async () => {
    const base = 'prose max-w-none [&_img]:mx-auto'
    const admin = makeAdmin({
      loadThemeConfig: vi.fn().mockResolvedValue({
        cssVars: {},
        activeTheme: 'blog',
        manifest: { name: 'blog', label: 'Blog', fields: [], postBody: { className: base } },
        values: {},
        colorScheme: 'auto',
      }),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest(makePost({ metadata: { postClasses: ['wide'] } })))
    const text = await res.text()
    // `&` in Tailwind arbitrary variants is entity-encoded; the browser
    // decodes it back, so the DOM class list matches the public page.
    expect(text).toContain('<main id="post-body" class="prose max-w-none [&amp;_img]:mx-auto ampless-post--wide">')
  })

  it('an explicit bodyClassName option wins over manifest postBody.className', async () => {
    const admin = makeAdmin({
      loadThemeConfig: vi.fn().mockResolvedValue({
        cssVars: {},
        activeTheme: 'blog',
        manifest: { name: 'blog', label: 'Blog', fields: [], postBody: { className: 'from-manifest' } },
        values: {},
        colorScheme: 'auto',
      }),
    })
    const handler = createPreviewRouteHandler(admin, { bodyClassName: 'from-option' })
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<main id="post-body" class="from-option">')
    expect(text).not.toContain('from-manifest')
  })

  it('sets data-theme on <body> and omits data-color-scheme for auto', async () => {
    const handler = createPreviewRouteHandler(makeAdmin())
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<body class="ampless-preview" data-theme="blog">')
    expect(text).toContain('<html>')
    expect(text).not.toContain('data-color-scheme')
  })

  it('sets data-color-scheme on <html> when the site pins a scheme', async () => {
    const admin = makeAdmin({
      loadThemeConfig: vi.fn().mockResolvedValue({
        cssVars: {},
        activeTheme: 'docs',
        manifest: { name: 'docs', label: 'Docs', fields: [] },
        values: {},
        colorScheme: 'dark',
      }),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<html data-color-scheme="dark">')
    expect(text).toContain('<body class="ampless-preview" data-theme="docs">')
  })

  it('HTML-escapes the base class, active theme and color scheme attribute values', async () => {
    const admin = makeAdmin({
      loadThemeConfig: vi.fn().mockResolvedValue({
        cssVars: {},
        activeTheme: 'x"><script>t</script>',
        manifest: { name: 'x', label: 'X', fields: [], postBody: { className: 'a&b "c" <d>' } },
        values: {},
        colorScheme: 'light" onload="x',
      }),
    })
    const handler = createPreviewRouteHandler(admin)
    const res = await handler(makeRequest())
    const text = await res.text()
    expect(text).toContain('<main id="post-body" class="a&amp;b &quot;c&quot; &lt;d&gt;">')
    expect(text).toContain('data-theme="x&quot;&gt;&lt;script&gt;t&lt;/script&gt;"')
    expect(text).toContain('<html data-color-scheme="light&quot; onload=&quot;x">')
    expect(text).not.toContain('<script>t</script>')
  })

  it('falls back to the option/default base without data-theme when loadThemeConfig throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const admin = makeAdmin({
        loadThemeConfig: vi.fn().mockRejectedValue(new Error('storage not configured')),
      })
      const res = await createPreviewRouteHandler(admin)(
        makeRequest(makePost({ metadata: { postClasses: ['wide'] } })),
      )
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain(
        '<main id="post-body" class="prose prose-neutral dark:prose-invert max-w-none ampless-post--wide">',
      )
      expect(text).toContain('<html>')
      expect(text).toContain('<body class="ampless-preview">')
      expect(text).not.toContain('data-theme')
      expect(text).not.toContain('data-color-scheme')
      expect(warn).toHaveBeenCalledWith('[ampless admin] preview theme CSS unavailable:', expect.any(Error))

      const withOption = await createPreviewRouteHandler(admin, { bodyClassName: 'opt' })(makeRequest())
      expect(await withOption.text()).toContain('<main id="post-body" class="opt">')
    } finally {
      warn.mockRestore()
    }
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
