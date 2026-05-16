import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { renderBody, markdownToHtml, htmlToMarkdown, tiptapToHtml } from './rendering.js'

function p(format: Post['format'], body: unknown): Post {
  return {
    postId: '1',
    siteId: 'default',
    slug: 's',
    title: 't',
    format,
    body,
    status: 'published',
    tags: [],
  }
}

describe('renderBody', () => {
  it('passes html bodies through unchanged', () => {
    expect(renderBody(p('html', '<p>hi</p>'))).toBe('<p>hi</p>')
  })

  it('renders markdown headers + paragraphs', () => {
    expect(renderBody(p('markdown', '# Hello\n\nworld'))).toContain('<h1>Hello</h1>')
    expect(renderBody(p('markdown', '# Hello\n\nworld'))).toContain('<p>world</p>')
  })

  it('renders a tiptap doc to HTML', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      ],
    }
    expect(renderBody(p('tiptap', doc))).toBe('<p>hi</p>')
  })

  it('renders a string tiptap body defensively (format-switch save path)', () => {
    expect(renderBody(p('tiptap', '<p>hi</p>'))).toBe('<p>hi</p>')
  })
})

describe('markdown <-> html round trips', () => {
  it('htmlToMarkdown handles headings and paragraphs', () => {
    const md = htmlToMarkdown('<h1>Hi</h1><p>there</p>')
    expect(md).toContain('# Hi')
    expect(md).toContain('there')
  })

  it('markdownToHtml + htmlToMarkdown is idempotent on a paragraph', () => {
    const html = markdownToHtml('plain line')
    expect(html).toContain('<p>plain line</p>')
  })
})

describe('tiptapToHtml', () => {
  it('returns the string verbatim when handed a string body', () => {
    expect(tiptapToHtml('<p>a</p>')).toBe('<p>a</p>')
  })
})
