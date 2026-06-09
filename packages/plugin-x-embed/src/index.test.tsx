import { describe, it, expect } from 'vitest'
import xEmbedPlugin from './index.js'
import { AmplessTweetNode } from './editor.js'

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
