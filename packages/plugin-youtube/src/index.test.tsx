// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { generateJSON, Mark, Node } from '@tiptap/core'
import youtubePlugin from './index.js'
import { AmplessYoutubeNode, tiptapNodeToMarkdown } from './editor.js'

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

const htmlParseExtensions = [
  TestDocument,
  TestParagraph,
  TestText,
  TestLink,
  AmplessYoutubeNode,
]

describe('youtubePlugin name', () => {
  it('uses simple identifier as default name', () => {
    const p = youtubePlugin()
    expect(p.name).toBe('youtube')
  })

  it('allows name override via opts', () => {
    const p = youtubePlugin({ name: 'my-yt' })
    expect(p.name).toBe('my-yt')
  })
})

it('paste rule regex carries the `g` flag (required by String.prototype.matchAll)', () => {
  // tiptap's paste-rule pipeline calls `text.matchAll(rule.find)`. Without
  // the `g` flag this throws `TypeError: String.prototype.matchAll called
  // with a non-global RegExp argument` at paste time, silently breaking
  // every embed paste. Lock the flag in.
  const rules = (AmplessYoutubeNode.config as any).addPasteRules?.call({ name: 'amplessYoutube' }) ?? []
  expect(rules.length).toBeGreaterThan(0)
  for (const rule of rules) {
    expect(rule.find).toBeInstanceOf(RegExp)
    expect((rule.find as RegExp).flags).toContain('g')
  }
})

it('paste rule regex matches a canonical URL via matchAll and captures the video id', () => {
  // Locks in two things at once: (a) matchAll doesn't throw, (b) the
  // capture groups are unchanged so the existing `handler` keeps
  // extracting `match[1] ?? match[2]` correctly.
  const rules = (AmplessYoutubeNode.config as any).addPasteRules?.call({ name: 'amplessYoutube' }) ?? []
  const url = 'https://youtu.be/dQw4w9WgXcQ'
  const matches = [...url.matchAll(rules[0].find as RegExp)]
  expect(matches.length).toBe(1)
  // youtu.be → match[2]; youtube.com/watch?v= → match[1]
  expect(matches[0][1] ?? matches[0][2]).toBe('dQw4w9WgXcQ')
})

describe('tiptapNodeToMarkdown adapter (amplessYoutube)', () => {
  const adapter = tiptapNodeToMarkdown['amplessYoutube']!

  it('returns the bare youtu.be URL for a valid videoId', () => {
    expect(adapter({ type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ' } }))
      .toBe('https://youtu.be/dQw4w9WgXcQ')
  })

  it('returns null when videoId is empty (falls through to default switch)', () => {
    expect(adapter({ type: 'amplessYoutube', attrs: { videoId: '' } })).toBeNull()
    expect(adapter({ type: 'amplessYoutube', attrs: {} })).toBeNull()
    expect(adapter({ type: 'amplessYoutube' })).toBeNull()
  })
})

describe('AmplessYoutubeNode.parseHTML', () => {
  const rules =
    (AmplessYoutubeNode.config as any).parseHTML?.call({ name: 'amplessYoutube' }) ?? []
  const linkRule = rules.find((rule: { tag?: string }) => rule.tag === 'a[href]')

  it('returns attrs for a canonical youtu.be URL', () => {
    const el = {
      getAttribute: (name: string) =>
        name === 'href' ? 'https://youtu.be/dQw4w9WgXcQ' : null,
    }

    expect(linkRule?.getAttrs(el)).toEqual({ videoId: 'dQw4w9WgXcQ', start: null })
  })

  it('returns attrs for a youtube.com/watch URL', () => {
    const el = {
      getAttribute: (name: string) =>
        name === 'href' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : null,
    }

    expect(linkRule?.getAttrs(el)).toEqual({ videoId: 'dQw4w9WgXcQ', start: null })
  })

  it('returns false for a non-YouTube URL', () => {
    const el = {
      getAttribute: (name: string) => (name === 'href' ? 'https://example.com/foo' : null),
    }

    expect(linkRule?.getAttrs(el)).toBe(false)
  })

  it('has priority 100 to beat the Link mark', () => {
    expect(linkRule?.priority).toBe(100)
  })

  it('restores a bare URL link paragraph to an embed node during HTML parse', () => {
    const doc = generateJSON(
      '<p><a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a></p>',
      htmlParseExtensions,
    )

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'amplessYoutube',
          attrs: { videoId: 'dQw4w9WgXcQ', start: null },
        },
      ],
    })
  })

  it('leaves non-YouTube links as normal link-marked text during HTML parse', () => {
    const doc = generateJSON(
      '<p><a href="https://example.com/foo">https://example.com/foo</a></p>',
      htmlParseExtensions,
    )

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/foo' } }],
              text: 'https://example.com/foo',
            },
          ],
        },
      ],
    })
  })
})
