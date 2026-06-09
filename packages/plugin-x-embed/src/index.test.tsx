// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { generateJSON, Mark, Node } from '@tiptap/core'
import xEmbedPlugin from './index.js'
import { AmplessTweetNode, tiptapNodeToMarkdown } from './editor.js'

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
  AmplessTweetNode,
]

describe('xEmbedPlugin name', () => {
  it('uses simple identifier as default name', () => {
    const p = xEmbedPlugin()
    expect(p.name).toBe('x-embed')
  })

  it('allows name override via opts', () => {
    const p = xEmbedPlugin({ name: 'my-x' })
    expect(p.name).toBe('my-x')
  })
})

it('paste rule regex carries the `g` flag (required by String.prototype.matchAll)', () => {
  // tiptap's paste-rule pipeline calls `text.matchAll(rule.find)`. Without
  // the `g` flag this throws `TypeError: String.prototype.matchAll called
  // with a non-global RegExp argument` at paste time, silently breaking
  // every embed paste. Lock the flag in.
  const rules = (AmplessTweetNode.config as any).addPasteRules?.call({ name: 'amplessTweet' }) ?? []
  expect(rules.length).toBeGreaterThan(0)
  for (const rule of rules) {
    expect(rule.find).toBeInstanceOf(RegExp)
    expect((rule.find as RegExp).flags).toContain('g')
  }
})

it('paste rule regex matches a canonical URL via matchAll and captures the tweet id', () => {
  // Locks in two things at once: (a) matchAll doesn't throw, (b) the
  // capture group is unchanged so the existing `handler` keeps
  // extracting `match[1]` correctly.
  const rules = (AmplessTweetNode.config as any).addPasteRules?.call({ name: 'amplessTweet' }) ?? []
  const url = 'https://x.com/ishinao/status/2063778809632235750'
  const matches = [...url.matchAll(rules[0].find as RegExp)]
  expect(matches.length).toBe(1)
  // TWEET_URL group 1 = status id
  expect(matches[0][1]).toBe('2063778809632235750')
})

describe('tiptapNodeToMarkdown adapter (amplessTweet)', () => {
  const adapter = tiptapNodeToMarkdown['amplessTweet']!

  it('returns the bare x.com/i/status/ URL for a valid tweetId', () => {
    const result = adapter({ type: 'amplessTweet', attrs: { tweetId: '2063778809632235750' } })
    expect(result).toBe('https://x.com/i/status/2063778809632235750')
  })

  it('output URL matches TWEET_URL regex (confirms round-trip via extractSingleUrl)', () => {
    // The generated URL must be accepted by TWEET_URL so that the existing
    // markdown → tiptap paste rule + extractSingleUrl can convert it back
    // to an amplessTweet node. Verify this statically to lock in the
    // contract without running a full markdown → tiptap parse.
    const TWEET_URL = /^https:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})(?:[?&#]\S*)?$/
    const url = 'https://x.com/i/status/2063778809632235750'
    const m = url.match(TWEET_URL)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('2063778809632235750')
  })

  it('returns null when tweetId is empty (falls through to default switch)', () => {
    expect(adapter({ type: 'amplessTweet', attrs: { tweetId: '' } })).toBeNull()
    expect(adapter({ type: 'amplessTweet', attrs: {} })).toBeNull()
    expect(adapter({ type: 'amplessTweet' })).toBeNull()
  })
})

describe('AmplessTweetNode.parseHTML', () => {
  const rules =
    (AmplessTweetNode.config as any).parseHTML?.call({ name: 'amplessTweet' }) ?? []
  const linkRule = rules.find((rule: { tag?: string }) => rule.tag === 'a[href]')

  it('returns attrs for a canonical x.com URL when link text equals href', () => {
    const url = 'https://x.com/ishinao/status/2063778809632235750'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: null,
    }

    expect(linkRule?.getAttrs(el)).toEqual({ tweetId: '2063778809632235750' })
  })

  it('returns attrs for a twitter.com URL when link text equals href', () => {
    const url = 'https://twitter.com/ishinao/status/2063778809632235750'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: null,
    }

    expect(linkRule?.getAttrs(el)).toEqual({ tweetId: '2063778809632235750' })
  })

  it('returns false for a non-tweet URL', () => {
    const url = 'https://example.com/foo'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: null,
    }

    expect(linkRule?.getAttrs(el)).toBe(false)
  })

  it('returns false for a caption link (link text ≠ href) even with a matching URL', () => {
    // Mirrors the markdown-side `extractSingleUrl` rule from PR #258: a
    // captioned link is not a bare URL, so it must stay a normal Link mark.
    const url = 'https://x.com/ishinao/status/2063778809632235750'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: 'see this tweet',
      parentElement: null,
    }

    expect(linkRule?.getAttrs(el)).toBe(false)
  })

  it('returns attrs when the parent is <body> (= top-level in the document)', () => {
    // ProseMirror's HTML parser wraps fragments in <body>, so a genuinely
    // top-level `<a>` reaches getAttrs with parent === <body>. This is the
    // shape the standalone-<a> integration test below exercises.
    const url = 'https://x.com/ishinao/status/2063778809632235750'
    const el = {
      getAttribute: (name: string) => (name === 'href' ? url : null),
      textContent: url,
      parentElement: { tagName: 'BODY' },
    }
    expect(linkRule?.getAttrs(el)).toEqual({ tweetId: '2063778809632235750' })
  })

  it('returns false for any content-block parent — preserves markdown / list / quote structure', () => {
    // The primary markdown bare URL line case (`<p><a href=URL>URL</a></p>`)
    // is handled by the tag:'p' rule above. The tag:'a[href]' rule is a
    // narrow fallback for body-level / no-parent links only. Inside ANY
    // content block — <p> (mixed prose), <li>, <blockquote>, <div> — the
    // autolink must stay an inline Link mark. Promoting it would split
    // lists into empty-paragraph items + list-external embeds, break
    // blockquotes, etc.
    const url = 'https://x.com/ishinao/status/2063778809632235750'
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
      '<p><a href="https://x.com/ishinao/status/2063778809632235750">https://x.com/ishinao/status/2063778809632235750</a></p>',
      htmlParseExtensions,
    )

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'amplessTweet',
          attrs: { tweetId: '2063778809632235750' },
        },
      ],
    })
  })

  it('leaves non-tweet links as normal link-marked text during HTML parse', () => {
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
      '<a href="https://x.com/ishinao/status/2063778809632235750">https://x.com/ishinao/status/2063778809632235750</a>',
      htmlParseExtensions,
    )

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'amplessTweet',
          attrs: { tweetId: '2063778809632235750' },
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
      '<p><a href="https://x.com/ishinao/status/2063778809632235750">watch this</a></p>',
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
              marks: [
                { type: 'link', attrs: { href: 'https://x.com/ishinao/status/2063778809632235750' } },
              ],
              text: 'watch this',
            },
          ],
        },
      ],
    })
  })

  it('leaves an autolink inside mixed prose as an inline Link mark, not a block embed', () => {
    // `<p>See <a href=URL>URL</a> today</p>` (= the GFM autolink inside
    // prose case): the URL link text DOES equal href, but promoting it to
    // a block embed would split the paragraph mid-sentence. The
    // `tag: 'p'` rule rejects this paragraph (mixed prose), and the
    // `tag: 'a[href]'` rule sees parent <p> and also rejects, so the link
    // stays an inline Link mark surrounded by the paragraph's other text.
    const url = 'https://x.com/ishinao/status/2063778809632235750'
    const doc = generateJSON(
      `<p>See <a href="${url}">${url}</a> today</p>`,
      htmlParseExtensions,
    )

    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: url } }],
              text: url,
            },
            { type: 'text', text: ' today' },
          ],
        },
      ],
    })
  })
})
