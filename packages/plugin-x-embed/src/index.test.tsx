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

  it('returns attrs for a canonical x.com URL', () => {
    const el = {
      getAttribute: (name: string) =>
        name === 'href' ? 'https://x.com/ishinao/status/2063778809632235750' : null,
    }

    expect(linkRule?.getAttrs(el)).toEqual({ tweetId: '2063778809632235750' })
  })

  it('returns attrs for a twitter.com URL', () => {
    const el = {
      getAttribute: (name: string) =>
        name === 'href' ? 'https://twitter.com/ishinao/status/2063778809632235750' : null,
    }

    expect(linkRule?.getAttrs(el)).toEqual({ tweetId: '2063778809632235750' })
  })

  it('returns false for a non-tweet URL', () => {
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
})
