import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AmplessPlugin, Post, PluginPublicRenderContext } from 'ampless'
import { definePlugin } from 'ampless'
import { buildContentFieldRegistry, renderBody } from './rendering.js'

function fakeCtx(): PluginPublicRenderContext {
  return {
    site: { name: 'X', url: 'https://x.example.com' },
    setting: () => undefined,
  }
}

function p(format: Post['format'], body: unknown): Post {
  return {
    postId: '1',
    slug: 's',
    title: 't',
    format,
    body,
    status: 'published',
    tags: [],
  }
}

const youtubePlugin: AmplessPlugin = definePlugin({
  name: 'youtube-test',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'amplessYoutube',
      render: (node) =>
        createElement('div', { 'data-yt': String(node.attrs?.videoId ?? '') }, 'YT'),
    },
    {
      kind: 'markdown-url',
      pattern: /^https:\/\/youtu\.be\/([\w-]{11})$/,
      render: ({ match }) =>
        createElement('div', { 'data-yt': match[1] }, 'YT'),
    },
  ],
})

function renderWith(plugins: AmplessPlugin[], post: Post): string {
  const registry = buildContentFieldRegistry(plugins)
  const node = renderBody(post, {
    contentFields: registry,
    ctxForPlugin: () => fakeCtx(),
  })
  return renderToStaticMarkup(node as React.ReactElement)
}

describe('contentFields tiptap renderer', () => {
  it('replaces a registered nodeType with the plugin renderer', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'amplessYoutube',
          attrs: { videoId: 'dQw4w9WgXcQ' },
        },
      ],
    }
    const html = renderWith([youtubePlugin], p('tiptap', doc))
    expect(html).toContain('data-yt="dQw4w9WgXcQ"')
    expect(html).toContain('YT')
  })

  it('falls through to default rendering for unknown nodeTypes', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    }
    const html = renderWith([youtubePlugin], p('tiptap', doc))
    expect(html).toContain('<p>')
    expect(html).toContain('plain')
  })
})

describe('contentFields markdown-url renderer', () => {
  it('replaces a single-line URL paragraph with the plugin renderer', () => {
    const md = 'before\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nafter'
    const html = renderWith([youtubePlugin], p('markdown', md))
    expect(html).toContain('data-yt="dQw4w9WgXcQ"')
    expect(html).toContain('before')
    expect(html).toContain('after')
  })

  it('does NOT replace an inline URL in a paragraph', () => {
    const md = 'see https://youtu.be/dQw4w9WgXcQ for details'
    const html = renderWith([youtubePlugin], p('markdown', md))
    expect(html).not.toContain('data-yt=')
    expect(html).toContain('see')
  })

  it('does NOT replace a [caption](url) markdown link with embed', () => {
    const md = '[watch this](https://youtu.be/dQw4w9WgXcQ)'
    const html = renderWith([youtubePlugin], p('markdown', md))
    // caption-link is NOT embedded — the link renders as a normal
    // markdown <a>. This keeps body rendering consistent with
    // hasTweetUrlInMarkdown (which only detects bare URL lines).
    expect(html).not.toContain('data-yt=')
    expect(html).toContain('watch this')
    expect(html).toContain('href="https://youtu.be/dQw4w9WgXcQ"')
  })

  it('does NOT replace a <url> autolink with embed', () => {
    const md = '<https://youtu.be/dQw4w9WgXcQ>'
    const html = renderWith([youtubePlugin], p('markdown', md))
    expect(html).not.toContain('data-yt=')
    // autolink renders as <a href="...">...</a>
    expect(html).toContain('href="https://youtu.be/dQw4w9WgXcQ"')
  })

  it('embeds a bare URL paragraph on its own line', () => {
    const md = 'https://youtu.be/dQw4w9WgXcQ'
    const html = renderWith([youtubePlugin], p('markdown', md))
    expect(html).toContain('data-yt=')
  })

  it('does NOT replace a URL inside a code block', () => {
    const md = '```\nhttps://youtu.be/dQw4w9WgXcQ\n```'
    const html = renderWith([youtubePlugin], p('markdown', md))
    expect(html).not.toContain('data-yt=')
  })
})

describe('block-safe wrapper', () => {
  it('wraps non-embed markdown in a <div> (not <span>)', () => {
    const md = '# heading\n\nparagraph'
    const html = renderWith([], p('markdown', md))
    // The HTML wrapper around the marked output is a <div>, not a <span>.
    expect(html).toMatch(/^<div[^>]*>.*<h1>heading<\/h1>.*<p>paragraph<\/p>.*<\/div>$/s)
    expect(html).not.toMatch(/<span[^>]*><h1>/)
  })

  it('format=html body is wrapped in a <div>', () => {
    const html = renderWith([], p('html', '<h1>title</h1>'))
    expect(html).toMatch(/^<div[^>]*><h1>title<\/h1><\/div>$/)
  })
})

describe('contentFields registry duplicate-reject', () => {
  it('throws when two plugins register the same tiptap nodeType', () => {
    const other: AmplessPlugin = definePlugin({
      name: 'dup-yt',
      apiVersion: 1,
      trust_level: 'trusted',
      capabilities: ['contentFields'],
      contentFields: [
        {
          kind: 'tiptap',
          nodeType: 'amplessYoutube',
          render: () => null,
        },
      ],
    })
    expect(() => buildContentFieldRegistry([youtubePlugin, other])).toThrow(
      /duplicate tiptap nodeType/,
    )
  })

  it('throws when two plugins register the same markdown-url pattern', () => {
    const other: AmplessPlugin = definePlugin({
      name: 'dup-md',
      apiVersion: 1,
      trust_level: 'trusted',
      capabilities: ['contentFields'],
      contentFields: [
        {
          kind: 'markdown-url',
          pattern: /^https:\/\/youtu\.be\/([\w-]{11})$/,
          render: () => null,
        },
      ],
    })
    expect(() => buildContentFieldRegistry([youtubePlugin, other])).toThrow(
      /duplicate markdown-url pattern/,
    )
  })
})

// ---- Public html walker (`format: 'html'` placeholder expansion) ----

/**
 * Fake plugin whose tiptap entry opts into the html walker via
 * `htmlPlaceholder`. The renderer echoes the resolved attrs so tests can
 * assert both that expansion happened AND that `attrsFromElement` ran
 * (incl. type coercion). `flagAttr` is `data-fake-embed`.
 */
const fakeHtmlPlugin: AmplessPlugin = definePlugin({
  name: 'fake-html',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'fakeEmbed',
      render: (node) =>
        createElement(
          'span',
          {
            'data-vid': String(node.attrs?.vid ?? ''),
            // number 30, not string "30", proves attrsFromElement coerced
            'data-start-type': typeof node.attrs?.start,
            'data-start': node.attrs?.start === undefined ? '' : String(node.attrs.start),
          },
          'EMBED',
        ),
      htmlPlaceholder: {
        flagAttr: 'data-fake-embed',
        attrsFromElement: (attribs) => {
          const start = Number(attribs['data-start'])
          return {
            vid: attribs['data-vid'] ?? '',
            start: Number.isFinite(start) && attribs['data-start'] !== undefined ? start : undefined,
          }
        },
      },
    },
  ],
})

/** Fake plugin whose renderer always throws (renderer-throw case). */
const throwingRenderPlugin: AmplessPlugin = definePlugin({
  name: 'throwing-render',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'boomEmbed',
      render: () => {
        throw new Error('render boom')
      },
      htmlPlaceholder: {
        flagAttr: 'data-boom-embed',
        attrsFromElement: (attribs) => ({ vid: attribs['data-vid'] ?? '' }),
      },
    },
  ],
})

/** Fake plugin whose `attrsFromElement` throws (attrs-throw case). */
const throwingAttrsPlugin: AmplessPlugin = definePlugin({
  name: 'throwing-attrs',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'attrsBoomEmbed',
      render: () => createElement('span', null, 'EMBED'),
      htmlPlaceholder: {
        flagAttr: 'data-attrs-boom-embed',
        attrsFromElement: () => {
          throw new Error('attrs boom')
        },
      },
    },
  ],
})

/** Fake plugin with a non-`data-ampless`-prefixed flagAttr. */
const customPrefixPlugin: AmplessPlugin = definePlugin({
  name: 'custom-prefix',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'myEmbed',
      render: (node) =>
        createElement('span', { 'data-vid': String(node.attrs?.vid ?? '') }, 'MY'),
      htmlPlaceholder: {
        flagAttr: 'data-my-embed',
        attrsFromElement: (attribs) => ({ vid: attribs['data-vid'] ?? '' }),
      },
    },
  ],
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('contentFields html walker', () => {
  it('expands a placeholder-only body into the plugin renderer output', () => {
    const body = '<div data-fake-embed data-vid="abc"><a href="u">u</a></div>'
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    expect(html).toContain('EMBED')
    expect(html).toContain('data-vid="abc"')
    // The literal placeholder div / link is gone — it was replaced.
    expect(html).not.toContain('data-fake-embed')
    expect(html).not.toContain('href="u"')
  })

  it('preserves bytes inside raw chunks; wrapper boundaries change', () => {
    // before/after are raw chunks whose bytes must be the ORIGINAL string,
    // and the center is the renderer output. The single-wrapper invariant
    // of placeholder-free posts is intentionally broken here (multiple
    // wrappers + embed sibling).
    const before = '<p>before &amp; co</p>'
    const placeholder = '<div data-fake-embed data-vid="xyz"></div>'
    const after = '<p>after</p>'
    const body = `${before}${placeholder}${after}`
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    // Raw chunk bytes preserved verbatim (entity `&amp;` not re-encoded).
    expect(html).toContain(before)
    expect(html).toContain(after)
    // Center replaced by renderer.
    expect(html).toContain('EMBED')
    expect(html).toContain('data-vid="xyz"')
    expect(html).not.toContain('data-fake-embed')
    // Wrapper boundary changed: there is more than one wrapper div now.
    const wrapperCount = (html.match(/<div/g) ?? []).length
    expect(wrapperCount).toBeGreaterThan(1)
  })

  it('does NOT expand a nested (non-top-level) placeholder', () => {
    const body = '<blockquote><div data-fake-embed data-vid="abc"></div></blockquote>'
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    // Stays literal — top-level only.
    expect(html).toContain('data-fake-embed')
    expect(html).not.toContain('EMBED')
  })

  it('does NOT expand an unregistered data-ampless-* style flag', () => {
    const body = '<div data-ampless-unknown data-vid="abc"></div>'
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    expect(html).toContain('data-ampless-unknown')
    expect(html).not.toContain('EMBED')
  })

  it('renderer throw → raw slice fallback (exact placeholder string) + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const placeholder = '<div data-boom-embed data-vid="abc"><a href="u">u</a></div>'
    const html = renderWith([throwingRenderPlugin], p('html', placeholder))
    // The fallback must be the EXACT original placeholder string — this
    // pins the `endIndex + 1` boundary (a bare `endIndex` slice would drop
    // the closing `>`).
    expect(html).toContain(placeholder)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('threw inside contentFields tiptap renderer')
  })

  it('attrsFromElement throw → raw slice fallback + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const placeholder = '<div data-attrs-boom-embed data-vid="abc"></div>'
    const html = renderWith([throwingAttrsPlugin], p('html', placeholder))
    expect(html).toContain(placeholder)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('threw inside contentFields tiptap renderer')
  })

  it('fast path: empty registry → markup identical to raw passthrough', () => {
    const body = '<h1>title</h1>'
    const html = renderWith([], p('html', body))
    expect(html).toBe('<div><h1>title</h1></div>')
  })

  it('fast path: no registered flagAttr in body → identical raw passthrough', () => {
    const body = '<h1>title</h1><p>no embeds here</p>'
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    // Markup-identical to the single-wrapper raw passthrough.
    expect(html).toBe(`<div>${body}</div>`)
  })

  it('expands a non-data-ampless prefix flagAttr (registry-key driven)', () => {
    const body = '<div data-my-embed data-vid="zzz"></div>'
    const html = renderWith([customPrefixPlugin], p('html', body))
    // Proves the fast path keys on registered flagAttrs, not a fixed
    // `data-ampless` prefix.
    expect(html).toContain('MY')
    expect(html).toContain('data-vid="zzz"')
    expect(html).not.toContain('data-my-embed')
  })

  it('expands an uppercase source attribute (case-insensitive)', () => {
    // htmlparser2 lowercases attribute names; the fast path lowercases the
    // body. `<div DATA-FAKE-EMBED …>` must still expand.
    const body = '<div DATA-FAKE-EMBED DATA-VID="up"></div>'
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    expect(html).toContain('EMBED')
    expect(html).toContain('data-vid="up"')
  })

  it('coerces data-start string → number for render (type conversion)', () => {
    const body = '<div data-fake-embed data-vid="abc" data-start="30"></div>'
    const html = renderWith([fakeHtmlPlugin], p('html', body))
    expect(html).toContain('data-start-type="number"')
    expect(html).toContain('data-start="30"')
  })
})
