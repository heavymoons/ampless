import { describe, it, expect } from 'vitest'
import readingTimePlugin, {
  extractPlainText,
  countWords,
  escapeHtml,
  normalizeWpm,
} from './index.js'
import type { Post } from 'ampless'

// ---------------------------------------------------------------------------
// Helpers to build minimal Post fixtures
// ---------------------------------------------------------------------------

function makePost(format: Post['format'], body: unknown): Post {
  return {
    postId: 'test-post',
    slug: 'test-post',
    title: 'Test Post',
    format,
    body,
    status: 'published',
  }
}

// Minimal PluginPublicRenderContext stub
function makeCtx(
  stored: Record<string, unknown> = {}
): Parameters<NonNullable<ReturnType<typeof readingTimePlugin>['publicHtmlForPost']>>[1] {
  return {
    site: { name: 'Test Site', url: 'http://localhost:3000' },
    setting<T>(key: string): T | undefined {
      return key in stored ? (stored[key] as T) : undefined
    },
  }
}

// ---------------------------------------------------------------------------
// 1. Plugin shape
// ---------------------------------------------------------------------------

describe('plugin shape', () => {
  it('has the correct name, packageName, and trust_level', () => {
    const plugin = readingTimePlugin()
    expect(plugin.name).toBe('reading-time')
    expect(plugin.packageName).toBe('@ampless/plugin-reading-time')
    expect(plugin.trust_level).toBe('untrusted')
  })

  it('has apiVersion 1', () => {
    const plugin = readingTimePlugin()
    expect(plugin.apiVersion).toBe(1)
  })

  it('declares publicHtmlForPost and adminSettings capabilities', () => {
    const plugin = readingTimePlugin()
    expect(plugin.capabilities).toContain('publicHtmlForPost')
    expect(plugin.capabilities).toContain('adminSettings')
  })

  it('settings.public contains wordsPerMinute, labelTemplate, position', () => {
    const plugin = readingTimePlugin()
    const keys = plugin.settings?.public?.map((f) => f.key) ?? []
    expect(keys).toContain('wordsPerMinute')
    expect(keys).toContain('labelTemplate')
    expect(keys).toContain('position')
  })

  it('package.json amplessPlugin.capabilities matches factory capabilities', async () => {
    // Dynamic import to read package.json from disk — validates Phase 5 invariant.
    const { default: pkg } = await import('../package.json', {
      assert: { type: 'json' },
    }) as { default: { amplessPlugin: { capabilities: string[] } } }
    const plugin = readingTimePlugin()
    const manifestCaps = [...pkg.amplessPlugin.capabilities].sort()
    const factoryCaps = [...(plugin.capabilities ?? [])].sort()
    expect(factoryCaps).toEqual(manifestCaps)
  })
})

// ---------------------------------------------------------------------------
// 2. publicHtmlForPost descriptor — basic shape
// ---------------------------------------------------------------------------

describe('publicHtmlForPost descriptor shape', () => {
  it('returns exactly one descriptor for a normal post', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world this is a test sentence with plenty of words.')
    const ctx = makeCtx()
    const descriptors = plugin.publicHtmlForPost!(post, ctx)
    expect(descriptors).toHaveLength(1)
  })

  it('descriptor has type html', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.type).toBe('html')
  })

  it('descriptor id is plugin-local "display"', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.id).toBe('display')
  })

  it('default position is beforeContent', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.position).toBe('beforeContent')
  })

  it('body contains <p class="ampless-reading-time">', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence longer text here.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toContain('<p class="ampless-reading-time"')
  })

  it('body contains data-words attribute', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toMatch(/data-words="\d+"/)
  })

  it('body contains data-minutes attribute', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toMatch(/data-minutes="\d+"/)
  })
})

// ---------------------------------------------------------------------------
// 3. Format-specific word count
// ---------------------------------------------------------------------------

describe('format-specific word count', () => {
  it('tiptap: extracts text from nested text nodes', () => {
    const plugin = readingTimePlugin()
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world example' }],
        },
      ],
    }
    const post = makePost('tiptap', body)
    // 3 English words → should produce a descriptor (words > 0)
    const descriptors = plugin.publicHtmlForPost!(post, makeCtx())
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0].body).toMatch(/data-words="[3-9]\d*"/)
  })

  it('markdown: strips syntax before counting words', () => {
    const plugin = readingTimePlugin()
    const md =
      '# Title\n\nThis is **bold** text with [link](https://x.com).'
    const post = makePost('markdown', md)
    const descriptors = plugin.publicHtmlForPost!(post, makeCtx())
    expect(descriptors).toHaveLength(1)
    // After stripping: "Title This is bold text with link." → ≥ 5 words
    const wordsMatch = descriptors[0].body.match(/data-words="(\d+)"/)
    expect(wordsMatch).not.toBeNull()
    expect(Number(wordsMatch![1])).toBeGreaterThanOrEqual(5)
  })

  it('html: strips tags before counting words', () => {
    const plugin = readingTimePlugin()
    const html = '<p>Hello <strong>world</strong></p>'
    const post = makePost('html', html)
    const descriptors = plugin.publicHtmlForPost!(post, makeCtx())
    expect(descriptors).toHaveLength(1)
    const wordsMatch = descriptors[0].body.match(/data-words="(\d+)"/)
    expect(Number(wordsMatch![1])).toBeGreaterThanOrEqual(2)
  })

  it('static format returns empty array (no badge)', () => {
    const plugin = readingTimePlugin()
    const post = makePost('static', { entrypoint: 'index.html', files: [] })
    const descriptors = plugin.publicHtmlForPost!(post, makeCtx())
    expect(descriptors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Japanese (CJK) word count
// ---------------------------------------------------------------------------

describe('CJK word count', () => {
  it('counts CJK chars as ceil(chars / 2) words', () => {
    // 'これはテストです' = 8 CJK characters → ceil(8/2) = 4 words
    const words = countWords('これはテストです')
    expect(words).toBeGreaterThanOrEqual(4)
  })

  it('mixed language: combines english words + CJK units', () => {
    // 'Hello これはテスト' → 1 English word + ceil(6/2)=3 CJK units = 4
    const words = countWords('Hello これはテスト')
    expect(words).toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// 5. labelTemplate placeholder substitution
// ---------------------------------------------------------------------------

describe('labelTemplate placeholder substitution', () => {
  it('default template renders "{minutes} min read"', () => {
    const plugin = readingTimePlugin({ wordsPerMinute: 200 })
    // 400 words at 200 WPM → 2 minutes
    const text = Array(400).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toContain('min read')
  })

  it('custom template replaces both {words} and {minutes}', () => {
    const plugin = readingTimePlugin({ wordsPerMinute: 100, labelTemplate: '{words} 単語 / {minutes} 分' })
    const text = Array(100).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toContain('単語')
    expect(d.body).toContain('分')
    // Should contain actual numbers
    expect(d.body).toMatch(/\d+ 単語/)
    expect(d.body).toMatch(/\d+ 分/)
  })

  it('HTML-escapes the rendered label (XSS prevention)', () => {
    const plugin = readingTimePlugin({ labelTemplate: '<script>alert(1)</script>' })
    const post = makePost('markdown', 'Hello world example sentence test more words.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    // Raw angle brackets must not appear inside the <p> body text
    expect(d.body).not.toContain('<script>')
    expect(d.body).toContain('&lt;script&gt;')
  })
})

// ---------------------------------------------------------------------------
// 6. wordsPerMinute calculation
// ---------------------------------------------------------------------------

describe('wordsPerMinute calculation', () => {
  it('wpm 100 + 300 words → 3 minutes', () => {
    const plugin = readingTimePlugin({ wordsPerMinute: 100 })
    // 300 space-separated words — use English so CJK path is not triggered
    const text = Array(300).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    expect(Number(minutesMatch![1])).toBe(3)
  })

  it('wpm 1000 + 100 words → 1 minute (ceil, minimum 1)', () => {
    const plugin = readingTimePlugin({ wordsPerMinute: 1000 })
    const text = Array(100).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    expect(Number(minutesMatch![1])).toBe(1)
  })

  it('fractional result is ceiling-rounded', () => {
    // 10 words at 200 WPM = 0.05 min → ceil → 1 (also max(1, …))
    const plugin = readingTimePlugin({ wordsPerMinute: 200 })
    const text = Array(10).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    expect(Number(minutesMatch![1])).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 7. position option
// ---------------------------------------------------------------------------

describe('position option', () => {
  it('afterContent position is reflected in descriptor', () => {
    const plugin = readingTimePlugin({ position: 'afterContent' })
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.position).toBe('afterContent')
  })

  it('beforeContent is the default position', () => {
    const plugin = readingTimePlugin()
    const post = makePost('markdown', 'Hello world example sentence.')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.position).toBe('beforeContent')
  })
})

// ---------------------------------------------------------------------------
// 8. stored settings override constructor defaults
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// normalizeWpm + integration with the plugin's render path
// ---------------------------------------------------------------------------

describe('normalizeWpm', () => {
  it('passes through values inside [50, 1000]', () => {
    expect(normalizeWpm(200, 999)).toBe(200)
    expect(normalizeWpm(50, 999)).toBe(50)
    expect(normalizeWpm(1000, 999)).toBe(1000)
  })

  it('falls back to fallback for 0 / negative / out-of-range', () => {
    expect(normalizeWpm(0, 200)).toBe(200)
    expect(normalizeWpm(-100, 200)).toBe(200)
    expect(normalizeWpm(49, 200)).toBe(200)
    expect(normalizeWpm(1001, 200)).toBe(200)
  })

  it('falls back to fallback for NaN / Infinity / non-numbers', () => {
    expect(normalizeWpm(Number.NaN, 200)).toBe(200)
    expect(normalizeWpm(Number.POSITIVE_INFINITY, 200)).toBe(200)
    expect(normalizeWpm(Number.NEGATIVE_INFINITY, 200)).toBe(200)
    expect(normalizeWpm(undefined, 200)).toBe(200)
    expect(normalizeWpm(null, 200)).toBe(200)
    expect(normalizeWpm({}, 200)).toBe(200)
    expect(normalizeWpm('not a number', 200)).toBe(200)
  })

  it('coerces numeric strings inside range', () => {
    // A stored value round-tripped through JSON may come back as a string.
    expect(normalizeWpm('250', 999)).toBe(250)
  })
})

describe('wordsPerMinute sanitization at the render path', () => {
  it('readingTimePlugin({ wordsPerMinute: 0 }) does not emit Infinity', () => {
    // Regression: previously this produced `data-minutes="Infinity"` and
    // an `Infinity min read` label because `0 || 200` evaluated to 200
    // ONLY when wpm was falsy at the resolve step — but the constructor
    // default itself was kept at 0, so the resolve fell back path was
    // hit for stored undefined, while a direct `wordsPerMinute: 0`
    // could leak through.
    const plugin = readingTimePlugin({ wordsPerMinute: 0 })
    const text = Array(200).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const ctx = makeCtx()
    const [d] = plugin.publicHtmlForPost!(post, ctx)
    expect(d.body).not.toContain('Infinity')
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    expect(minutesMatch).not.toBeNull()
    // 200 words / 200 wpm fallback = 1 min
    expect(Number(minutesMatch![1])).toBe(1)
  })

  it('stored NaN / non-finite wordsPerMinute falls back to the constructor default', () => {
    const plugin = readingTimePlugin({ wordsPerMinute: 100 })
    const text = Array(100).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    // Simulate a stored value of NaN reaching the render path
    // (e.g. corrupted DDB write, schema drift).
    const ctx = makeCtx({ wordsPerMinute: Number.NaN })
    const [d] = plugin.publicHtmlForPost!(post, ctx)
    expect(d.body).not.toContain('Infinity')
    expect(d.body).not.toContain('NaN')
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    // 100 words / 100 wpm (constructor fallback) = 1 min
    expect(Number(minutesMatch![1])).toBe(1)
  })

  it('stored Infinity falls back to the constructor default', () => {
    const plugin = readingTimePlugin({ wordsPerMinute: 500 })
    const text = Array(500).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const ctx = makeCtx({ wordsPerMinute: Number.POSITIVE_INFINITY })
    const [d] = plugin.publicHtmlForPost!(post, ctx)
    expect(d.body).not.toContain('Infinity')
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    // 500 / 500 = 1 min (constructor fallback wins)
    expect(Number(minutesMatch![1])).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// countWords precision: punctuation-only tokens
// ---------------------------------------------------------------------------

describe('countWords — letter/digit-required tokens', () => {
  it('does not count pure-punctuation tokens as words', () => {
    // Mixed-script Japanese: `これはテストです。`
    // Before the fix the trailing `。` separated by the CJK strip would
    // count as one English word, inflating the total to 5 (CJK 4 + `。`).
    // After the fix only tokens with at least one letter or digit are
    // counted, so `。` drops out and the result is CJK 4 = ceil(8/2) = 4.
    const text = 'これはテストです。'
    expect(countWords(text)).toBe(4)
  })

  it('strips markdown leftover punctuation runs (---, ***)', () => {
    expect(countWords('Hello --- world')).toBe(2)
    expect(countWords('one *** two')).toBe(2)
  })

  it("keeps contractions (don't) and hyphenated compounds (state-of-the-art) as one word", () => {
    expect(countWords("don't")).toBe(1)
    expect(countWords('state-of-the-art')).toBe(1)
  })

  it('still counts digits as words', () => {
    expect(countWords('2024 was a good year')).toBe(5)
  })
})

describe('stored settings override', () => {
  it('stored wordsPerMinute overrides constructor default', () => {
    // Constructor default wpm = 200; stored = 100; 200 words → 2 min at 100 wpm
    const plugin = readingTimePlugin({ wordsPerMinute: 200 })
    const text = Array(200).fill('word').join(' ')
    const post = makePost('html', `<p>${text}</p>`)
    const ctx = makeCtx({ wordsPerMinute: 100 })
    const [d] = plugin.publicHtmlForPost!(post, ctx)
    const minutesMatch = d.body.match(/data-minutes="(\d+)"/)
    // 200 words / 100 wpm = 2 min
    expect(Number(minutesMatch![1])).toBe(2)
  })

  it('stored position overrides constructor default', () => {
    const plugin = readingTimePlugin({ position: 'beforeContent' })
    const post = makePost('markdown', 'Hello world example sentence.')
    const ctx = makeCtx({ position: 'afterContent' })
    const [d] = plugin.publicHtmlForPost!(post, ctx)
    expect(d.position).toBe('afterContent')
  })
})

// ---------------------------------------------------------------------------
// 9. escapeHtml unit tests
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes all five special HTML characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('1 min read')).toBe('1 min read')
  })
})

// ---------------------------------------------------------------------------
// 10. extractPlainText unit tests
// ---------------------------------------------------------------------------

describe('extractPlainText', () => {
  it('static format returns empty string', () => {
    const post = makePost('static', { entrypoint: 'index.html', files: [] })
    expect(extractPlainText(post)).toBe('')
  })

  it('unknown format returns empty string', () => {
    const post = makePost('html', 'irrelevant')
    // Force an unsupported format via cast
    ;(post as unknown as { format: string }).format = 'docx'
    expect(extractPlainText(post)).toBe('')
  })

  it('markdown strips fenced code blocks', () => {
    const md = 'Before\n```\ncode here\n```\nafter'
    const post = makePost('markdown', md)
    const text = extractPlainText(post)
    expect(text).not.toContain('code here')
    expect(text).toContain('Before')
    expect(text).toContain('after')
  })
})
