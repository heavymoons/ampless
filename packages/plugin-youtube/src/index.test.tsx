// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { generateJSON, Mark, Node } from '@tiptap/core'
import youtubePlugin from './index.js'
import { AmplessYoutubeNode, tiptapNodeToMarkdown, tiptapNodeToHtml } from './editor.js'

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

  it('returns attrs for a canonical youtu.be URL when link text equals href', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: null,   // standalone <a>, not inside a <p>
    }

    expect(linkRule?.getAttrs(el)).toEqual({ videoId: 'dQw4w9WgXcQ', start: null })
  })

  it('returns attrs for a youtube.com/watch URL when link text equals href', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: null,   // standalone <a>, not inside a <p>
    }

    expect(linkRule?.getAttrs(el)).toEqual({ videoId: 'dQw4w9WgXcQ', start: null })
  })

  it('returns false for a non-YouTube URL', () => {
    const url = 'https://example.com/foo'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: null,   // standalone <a>, not inside a <p>
    }

    expect(linkRule?.getAttrs(el)).toBe(false)
  })

  it('returns false for a caption link (link text ≠ href) even with a matching URL', () => {
    // Mirrors the markdown-side `extractSingleUrl` rule from PR #258: a
    // captioned link is not a bare URL, so it must stay a normal Link mark.
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: 'watch this',
      parentElement: null,
    }

    expect(linkRule?.getAttrs(el)).toBe(false)
  })

  it('returns attrs when the parent is <body> (= top-level in the document)', () => {
    // ProseMirror's HTML parser wraps fragments in <body>, so a genuinely
    // top-level `<a>` reaches getAttrs with parent === <body>. This is the
    // shape the standalone-<a> integration test below exercises.
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: { tagName: 'BODY' },
    }
    expect(linkRule?.getAttrs(el)).toEqual({ videoId: 'dQw4w9WgXcQ', start: null })
  })

  it('returns false for any content-block parent — preserves markdown / list / quote structure', () => {
    // The primary markdown bare URL line case (`<p><a href=URL>URL</a></p>`)
    // is handled by the tag:'p' rule above. The tag:'a[href]' rule is a
    // narrow fallback for body-level / no-parent links only. Inside ANY
    // content block — <p> (mixed prose), <li>, <blockquote>, <div> — the
    // autolink must stay an inline Link mark. Promoting it would split
    // lists into empty-paragraph items + list-external embeds, break
    // blockquotes, etc.
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const parents = [
      { tagName: 'P' },          // mixed prose <p> (single-link <p> handled by tag:'p')
      { tagName: 'LI' },         // list item — keep list structure
      { tagName: 'BLOCKQUOTE' }, // quote — keep quote structure
      { tagName: 'DIV' },        // arbitrary div wrapper — be conservative
    ]
    for (const parentElement of parents) {
      const el = {
        getAttribute: (name: string) => (name === 'href' ? url : null),
        textContent: url,
        parentElement,
      }
      expect(linkRule?.getAttrs(el)).toBe(false)
    }
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

  it('restores a standalone bare URL <a> (no <p> wrapper) to an embed node', () => {
    // Goes through the `tag: 'a[href]'` rule rather than the `tag: 'p'`
    // single-link-paragraph rule, so this covers the standalone-link path
    // (e.g. HTML pasted from sources that don't wrap each link in its own
    // paragraph).
    const doc = generateJSON(
      '<a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a>',
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

  it('keeps a caption link (link text ≠ href) as a captioned Link, not an embed', () => {
    // Mirrors the markdown-side `extractSingleUrl` rule from PR #258:
    // `[caption](url)` markdown links stay as captioned Link marks instead
    // of being silently swallowed into an embed. The HTML-to-tiptap path
    // honours the same semantic on `<a href="URL">caption</a>` shapes.
    const doc = generateJSON(
      '<p><a href="https://youtu.be/dQw4w9WgXcQ">watch this</a></p>',
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
              marks: [{ type: 'link', attrs: { href: 'https://youtu.be/dQw4w9WgXcQ' } }],
              text: 'watch this',
            },
          ],
        },
      ],
    })
  })

  it('leaves an autolink inside mixed prose as an inline Link mark, not a block embed', () => {
    // `<p>Watch <a href=URL>URL</a> today</p>` (= the GFM autolink inside
    // prose case): the URL link text DOES equal href, but promoting it to
    // a block embed would split the paragraph mid-sentence. The
    // `tag: 'p'` rule rejects this paragraph (mixed prose), and the
    // `tag: 'a[href]'` rule sees parent <p> and also rejects, so the link
    // stays an inline Link mark surrounded by the paragraph's other text.
    const doc = generateJSON(
      '<p>Watch <a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a> today</p>',
      htmlParseExtensions,
    )

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Watch ' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://youtu.be/dQw4w9WgXcQ' } }],
              text: 'https://youtu.be/dQw4w9WgXcQ',
            },
            { type: 'text', text: ' today' },
          ],
        },
      ],
    })
  })
})

describe('tiptapNodeToHtml adapter (amplessYoutube)', () => {
  const adapter = tiptapNodeToHtml['amplessYoutube']!

  it('returns the placeholder div for a valid videoId', () => {
    const result = adapter({ type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ', start: null } })
    expect(typeof result).toBe('string')
    expect(result).toContain('data-ampless-youtube')
    expect(result).toContain('data-video-id="dQw4w9WgXcQ"')
    expect(result).toContain('class="ampless-youtube-placeholder"')
  })

  it('inner content is a clickable canonical URL link, NOT the editor span label', () => {
    // Regression guard: the adapter must not emit `<span>YouTube: id</span>`
    // (the editor visual label from Node.renderHTML). On public render of
    // `format: 'html'` posts, the body ships literally, so an editor-internal
    // label would leak. The canonical URL link gracefully degrades and
    // mirrors the markdown bare-URL canonical form.
    const result = adapter({ type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ', start: null } })
    expect(result).toContain('<a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a>')
    expect(result).not.toContain('<span>')
    expect(result).not.toContain('YouTube:')
  })

  it('returns null when videoId is empty (falls through to default switch)', () => {
    expect(adapter({ type: 'amplessYoutube', attrs: { videoId: '', start: null } })).toBeNull()
    expect(adapter({ type: 'amplessYoutube', attrs: {} })).toBeNull()
    expect(adapter({ type: 'amplessYoutube' })).toBeNull()
  })

  it('includes data-start when start attr is a finite number', () => {
    const result = adapter({ type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ', start: 42 } })
    expect(result).toContain('data-start="42"')
  })

  it('omits data-start when start attr is null', () => {
    const result = adapter({ type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ', start: null } })
    expect(result).not.toContain('data-start')
  })
})

describe('html ↔ tiptap round-trip integration (amplessYoutube)', () => {
  it('placeholder div → tiptap node → placeholder div round-trips losslessly', () => {
    const canonical =
      '<div data-ampless-youtube data-video-id="dQw4w9WgXcQ" class="ampless-youtube-placeholder"><span>YouTube: dQw4w9WgXcQ</span></div>'
    // Round 1: HTML → tiptap (parseHTML)
    const doc = generateJSON(canonical, htmlParseExtensions)
    const node = doc.content?.[0]
    expect(node).toEqual({
      type: 'amplessYoutube',
      attrs: { videoId: 'dQw4w9WgXcQ', start: null },
    })
    // Round 2: tiptap node → HTML (adapter called directly, no runtime dep)
    const adapter = tiptapNodeToHtml['amplessYoutube']!
    const html2 = adapter(node)
    expect(typeof html2).toBe('string')
    // Re-round 1: HTML → tiptap, same Node back?
    expect(generateJSON(html2!, htmlParseExtensions)).toEqual(doc)
  })

  it('round-trip preserves the start attr (YouTube ?t=<sec> variant)', () => {
    // A placeholder div that includes data-start="30" must parse back to a
    // node with start: 30 and re-serialise with data-start="30".
    const canonical =
      '<div data-ampless-youtube data-video-id="dQw4w9WgXcQ" data-start="30" class="ampless-youtube-placeholder"><span>YouTube: dQw4w9WgXcQ</span></div>'
    const doc = generateJSON(canonical, htmlParseExtensions)
    const node = doc.content?.[0]
    expect(node).toEqual({
      type: 'amplessYoutube',
      attrs: { videoId: 'dQw4w9WgXcQ', start: 30 },
    })
    const adapter = tiptapNodeToHtml['amplessYoutube']!
    const html2 = adapter(node)
    expect(html2).toContain('data-start="30"')
    expect(generateJSON(html2!, htmlParseExtensions)).toEqual(doc)
  })
})
