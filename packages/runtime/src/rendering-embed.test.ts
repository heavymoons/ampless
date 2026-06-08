import { describe, it, expect } from 'vitest'
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
