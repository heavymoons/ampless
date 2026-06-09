// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { Node, Mark, generateJSON } from '@tiptap/core'
import { convertBodyFormat } from './format-switch.js'
import type { FormatSwitchRegistries } from './format-switch.js'

// Minimal tiptap extensions for the format-switch 2-hop tests.
const TestDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
})

const TestParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML() {
    return [{ tag: 'p' }]
  },
  renderHTML() {
    return ['p', 0]
  },
})

const TestText = Node.create({
  name: 'text',
  group: 'inline',
})

const TestLink = Mark.create({
  name: 'link',
  priority: 50,
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('href'),
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (el) => {
          const href = (el as HTMLElement).getAttribute('href')
          return href ? { href } : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', HTMLAttributes, 0]
  },
})

// A fake embed node that promotes <p><a href=URL>URL</a></p> to a block node,
// mirroring the real youtube/x-embed parseHTML rules.
const FakeEmbedNode = Node.create({
  name: 'fakeEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-url') ?? '',
        renderHTML: (attrs) => ({ 'data-url': String(attrs.url ?? '') }),
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-fake-embed]',
      },
      {
        tag: 'p',
        priority: 100,
        getAttrs: (el) => {
          const p = el as HTMLElement
          const children = Array.from(p.children)
          if (children.length !== 1) return false
          const link = children[0] as HTMLElement
          if (link.tagName.toLowerCase() !== 'a') return false
          const href = link.getAttribute('href')?.trim() ?? ''
          if (!href.startsWith('https://fake.example.com/')) return false
          if (link.textContent?.trim() !== href) return false
          if (p.textContent?.trim() !== href) return false
          return { url: href }
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-fake-embed': '', ...HTMLAttributes }, 0]
  },
})

const testExtensions = [TestDocument, TestParagraph, TestText, TestLink, FakeEmbedNode]

// Canned registries for the tests
const cannedRegistries: FormatSwitchRegistries = {
  markdownAdapters: {},
  htmlAdapters: {
    fakeEmbed: (node) => {
      const url = String(node.attrs?.url ?? '').trim()
      if (!url) return null
      return `<div data-fake-embed data-url="${url}"></div>`
    },
  },
  editorExtensions: testExtensions,
}

describe('convertBodyFormat', () => {
  it('same-format conversion is a no-op (defensive guard)', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(convertBodyFormat(body, 'tiptap', 'tiptap', cannedRegistries)).toBe(body)
    expect(convertBodyFormat('hello', 'markdown', 'markdown', cannedRegistries)).toBe('hello')
    expect(convertBodyFormat('<p>hi</p>', 'html', 'html', cannedRegistries)).toBe('<p>hi</p>')
  })

  it('markdown → html: bare embed URL produces placeholder div (not <p><a ...>)', () => {
    // The 2-hop: markdownToHtml emits <p><a href=URL>URL</a></p>, generateJSON
    // promotes it to a fakeEmbed Node via the tag:'p' parseHTML rule, then the
    // html adapter serialises it to the placeholder div.
    const md = 'https://fake.example.com/embed-123'
    const result = convertBodyFormat(md, 'markdown', 'html', cannedRegistries)
    expect(typeof result).toBe('string')
    const html = result as string
    // Must contain the placeholder div, NOT a bare <p><a...>
    expect(html).toContain('data-fake-embed')
    expect(html).toContain('data-url="https://fake.example.com/embed-123"')
    expect(html).not.toContain('<p><a')
  })

  it('tiptap → html: embed node is serialised by the html adapter', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'fakeEmbed', attrs: { url: 'https://fake.example.com/embed-456' } },
      ],
    }
    const result = convertBodyFormat(doc, 'tiptap', 'html', cannedRegistries)
    expect(typeof result).toBe('string')
    const html = result as string
    expect(html).toContain('data-fake-embed')
    expect(html).toContain('data-url="https://fake.example.com/embed-456"')
  })

  it('html → tiptap: returns the HTML string (tiptap parses on mount)', () => {
    const html = '<p>hello world</p>'
    expect(convertBodyFormat(html, 'html', 'tiptap', cannedRegistries)).toBe(html)
  })

  it('tiptap → markdown: uses the markdown adapter', () => {
    const markdownRegistries: FormatSwitchRegistries = {
      ...cannedRegistries,
      markdownAdapters: {
        fakeEmbed: (node) => {
          const url = String(node.attrs?.url ?? '').trim()
          return url || null
        },
      },
    }
    const doc = {
      type: 'doc',
      content: [
        { type: 'fakeEmbed', attrs: { url: 'https://fake.example.com/embed-789' } },
      ],
    }
    const result = convertBodyFormat(doc, 'tiptap', 'markdown', markdownRegistries)
    expect(typeof result).toBe('string')
    expect(result as string).toContain('https://fake.example.com/embed-789')
  })

  it('html → markdown: converts HTML to markdown', () => {
    const result = convertBodyFormat('<h1>Title</h1><p>para</p>', 'html', 'markdown', cannedRegistries)
    expect(typeof result).toBe('string')
    expect(result as string).toContain('# Title')
    expect(result as string).toContain('para')
  })

  it('markdown → tiptap: converts markdown via markdownToHtml (string result for tiptap editor)', () => {
    const result = convertBodyFormat('# Hello', 'markdown', 'tiptap', cannedRegistries)
    expect(typeof result).toBe('string')
    expect(result as string).toContain('<h1>Hello</h1>')
  })
})
