import { describe, it, expect } from 'vitest'
import youtubePlugin from './index.js'
import { AmplessYoutubeNode, tiptapNodeToMarkdown } from './editor.js'

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
