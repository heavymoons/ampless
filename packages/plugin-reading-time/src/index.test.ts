import { describe, it, expect } from 'vitest'
import readingTimePlugin, {
  extractPlainText,
  countWords,
  escapeHtml,
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
