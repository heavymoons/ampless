import { describe, it, expect } from 'vitest'
import sanitizeHtml from 'sanitize-html'
import aiActionsPlugin, { escapeHtml } from './index.js'
import type { Post } from 'ampless'

// ---------------------------------------------------------------------------
// Helpers to build minimal Post / ctx fixtures
// ---------------------------------------------------------------------------

function makePost(slug: string): Post {
  return {
    postId: 'test-post',
    slug,
    title: 'Test Post',
    format: 'markdown',
    body: 'Hello world.',
    status: 'published',
  }
}

type Ctx = Parameters<NonNullable<ReturnType<typeof aiActionsPlugin>['publicHtmlForPost']>>[1]

function makeCtx(
  stored: Record<string, unknown> = {},
  siteUrl = 'https://example.com'
): Ctx {
  return {
    site: { name: 'Test Site', url: siteUrl },
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
    const plugin = aiActionsPlugin()
    expect(plugin.name).toBe('ai-actions')
    expect(plugin.packageName).toBe('@ampless/plugin-ai-actions')
    expect(plugin.trust_level).toBe('untrusted')
  })

  it('has apiVersion 1', () => {
    const plugin = aiActionsPlugin()
    expect(plugin.apiVersion).toBe(1)
  })

  it('declares publicHtmlForPost and adminSettings capabilities', () => {
    const plugin = aiActionsPlugin()
    expect(plugin.capabilities).toContain('publicHtmlForPost')
    expect(plugin.capabilities).toContain('adminSettings')
  })

  it('settings.public contains showMarkdownLink, showClaude, showChatgpt, promptTemplate, position', () => {
    const plugin = aiActionsPlugin()
    const keys = plugin.settings?.public?.map((f) => f.key) ?? []
    expect(keys).toContain('showMarkdownLink')
    expect(keys).toContain('showClaude')
    expect(keys).toContain('showChatgpt')
    expect(keys).toContain('promptTemplate')
    expect(keys).toContain('position')
  })

  it('package.json amplessPlugin.capabilities matches factory capabilities', async () => {
    const { default: pkg } = (await import('../package.json', {
      assert: { type: 'json' },
    })) as { default: { amplessPlugin: { capabilities: string[] } } }
    const plugin = aiActionsPlugin()
    const manifestCaps = [...pkg.amplessPlugin.capabilities].sort()
    const factoryCaps = [...(plugin.capabilities ?? [])].sort()
    expect(factoryCaps).toEqual(manifestCaps)
  })
})

// ---------------------------------------------------------------------------
// 2. publicHtmlForPost descriptor — basic shape
// ---------------------------------------------------------------------------

describe('publicHtmlForPost descriptor shape', () => {
  it('returns exactly one descriptor when at least one link is enabled', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const descriptors = plugin.publicHtmlForPost!(post, makeCtx())
    expect(descriptors).toHaveLength(1)
  })

  it('descriptor has type html and id "actions"', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.type).toBe('html')
    expect(d.id).toBe('actions')
  })

  it('default position is afterContent', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.position).toBe('afterContent')
  })

  it('stored position overrides the default', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx({ position: 'beforeContent' }))
    expect(d.position).toBe('beforeContent')
  })

  it('constructor position overrides the built-in default', () => {
    const plugin = aiActionsPlugin({ position: 'beforeContent' })
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.position).toBe('beforeContent')
  })

  it('body is wrapped in <p class="ampless-ai-actions">', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toMatch(/^<p class="ampless-ai-actions">.*<\/p>$/)
  })
})

// ---------------------------------------------------------------------------
// 3. href generation — View as Markdown (relative link)
// ---------------------------------------------------------------------------

describe('View as Markdown href', () => {
  it('links to /<slug>.md', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toContain('href="/hello-world.md"')
    expect(d.body).toContain('>View as Markdown<')
  })

  it('percent-encodes non-ASCII slugs', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('日本語')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).toContain('href="/%E6%97%A5%E6%9C%AC%E8%AA%9E.md"')
  })

  it('percent-encodes parentheses in the slug (fixedEncodeURIComponent)', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('foo(bar)')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    // encodeURIComponent leaves ( ) unescaped; fixedEncodeURIComponent
    // percent-encodes them same as the runtime's llms.ts helper.
    expect(d.body).toContain('href="/foo%28bar%29.md"')
    expect(d.body).not.toContain('(bar)')
  })

  it('renders the link relative even when site.url is set', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx({}, 'https://example.com'))
    expect(d.body).toContain('href="/hello-world.md"')
    expect(d.body).not.toContain('href="https://example.com/hello-world.md"')
  })
})

// ---------------------------------------------------------------------------
// 4. href generation — Open in Claude / Open in ChatGPT
// ---------------------------------------------------------------------------

describe('Open in Claude / Open in ChatGPT href', () => {
  it('is hidden by default (opt-in)', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).not.toContain('ampless-ai-actions-claude')
    expect(d.body).not.toContain('ampless-ai-actions-chatgpt')
  })

  it('builds the Claude URL from the default prompt template + absolute .md URL', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true }, 'https://example.com')
    )
    const expectedQ = encodeURIComponent('Read https://example.com/hello-world.md')
    expect(d.body).toContain(`href="https://claude.ai/new?q=${expectedQ}"`)
    expect(d.body).toContain('target="_blank"')
    expect(d.body).toContain('rel="noopener noreferrer"')
    expect(d.body).toContain('>Open in Claude<')
  })

  it('builds the ChatGPT URL from a custom prompt template', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx(
        { showChatgpt: true, promptTemplate: 'Summarize {url} please & thanks' },
        'https://example.com'
      )
    )
    const expectedQ = encodeURIComponent(
      'Summarize https://example.com/hello-world.md please & thanks'
    )
    expect(d.body).toContain(`href="https://chatgpt.com/?q=${expectedQ}"`)
    // The raw '&' must not survive un-encoded into the href attribute value.
    expect(d.body).not.toMatch(/href="[^"]*&[^"]*"/)
  })

  it('both Claude and ChatGPT can be enabled simultaneously, separated by a separator span', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true, showChatgpt: true }, 'https://example.com')
    )
    expect(d.body).toContain('ampless-ai-actions-claude')
    expect(d.body).toContain('ampless-ai-actions-chatgpt')
    expect(d.body).toContain('ampless-ai-actions-sep')
  })
})

// ---------------------------------------------------------------------------
// 5. toggles
// ---------------------------------------------------------------------------

describe('toggles', () => {
  it('all three disabled returns an empty array', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const descriptors = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showMarkdownLink: false, showClaude: false, showChatgpt: false })
    )
    expect(descriptors).toHaveLength(0)
  })

  it('site.url empty hides Claude/ChatGPT even when toggled on, but keeps View', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true, showChatgpt: true }, '')
    )
    expect(d.body).toContain('ampless-ai-actions-md')
    expect(d.body).not.toContain('ampless-ai-actions-claude')
    expect(d.body).not.toContain('ampless-ai-actions-chatgpt')
  })

  it('site.url empty + showMarkdownLink false returns empty array', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const descriptors = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showMarkdownLink: false, showClaude: true, showChatgpt: true }, '')
    )
    expect(descriptors).toHaveLength(0)
  })

  it('showMarkdownLink false + showClaude true renders only Claude', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx(
        { showMarkdownLink: false, showClaude: true },
        'https://example.com'
      )
    )
    expect(d.body).not.toContain('ampless-ai-actions-md')
    expect(d.body).toContain('ampless-ai-actions-claude')
  })
})

// ---------------------------------------------------------------------------
// 6. site.url trailing slash normalization
// ---------------------------------------------------------------------------

describe('site.url trailing slash normalization', () => {
  it('strips a single trailing slash before building the absolute .md URL', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true }, 'https://example.com/')
    )
    const expectedQ = encodeURIComponent('Read https://example.com/hello-world.md')
    expect(d.body).toContain(`href="https://claude.ai/new?q=${expectedQ}"`)
  })

  it('strips multiple trailing slashes', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true }, 'https://example.com///')
    )
    const expectedQ = encodeURIComponent('Read https://example.com/hello-world.md')
    expect(d.body).toContain(`href="https://claude.ai/new?q=${expectedQ}"`)
  })
})

// ---------------------------------------------------------------------------
// 7. XSS — adversarial slugs
// ---------------------------------------------------------------------------

describe('XSS: adversarial slugs are escaped as href attribute values', () => {
  it('a slug containing a double quote does not break out of the href attribute', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('foo"onmouseover="alert(1)')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    // encodeURIComponent already percent-encodes '"' to %22, so the raw
    // character must not appear un-encoded inside the href value.
    expect(d.body).not.toContain('"onmouseover="alert(1)"')
    expect(d.body).toContain('%22onmouseover%3D')
  })

  it('a slug containing < does not inject a tag', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('<script>alert(1)</script>')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(d.body).not.toContain('<script>')
    expect(d.body).toContain('%3Cscript%3E')
  })
})

// ---------------------------------------------------------------------------
// 8. escapeHtml unit tests
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes all five special HTML characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('View as Markdown')).toBe('View as Markdown')
  })
})

// ---------------------------------------------------------------------------
// 9. sanitize round-trip (P2 in the plan) — the runtime's sanitize-html
// pass must not alter a single byte of the markup this plugin generates.
//
// SYNC SOURCE: this SANITIZE_OPTIONS object is a deliberate duplicate of
// `SANITIZE_OPTIONS` in `packages/runtime/src/plugin-head.ts` (search for
// "Phase 6d — publicHtmlForPost: strict sanitize-html profile"). If that
// object changes, update this copy too — the whole point of this test is
// to catch drift between what this plugin emits and what the runtime's
// real sanitizer allows through.
// ---------------------------------------------------------------------------

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'span', 'strong', 'em', 'a', 'code', 'br', 'ul', 'ol', 'li'],
  allowedAttributes: {
    '*': ['class', 'data-words', 'data-minutes', 'data-ampless-*'],
    a: ['href', 'rel', 'target'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const out = { ...attribs }
      if (out['target'] === '_blank') {
        const parts = (out['rel'] ?? '').split(/\s+/).filter(Boolean)
        if (!parts.includes('noopener')) parts.push('noopener')
        if (!parts.includes('noreferrer')) parts.push('noreferrer')
        out['rel'] = parts.join(' ')
      }
      return { tagName, attribs: out }
    },
  },
}

describe('sanitize round-trip (sync source: packages/runtime/src/plugin-head.ts SANITIZE_OPTIONS)', () => {
  it('View-only markup survives sanitize-html byte-for-byte', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(post, makeCtx())
    expect(sanitizeHtml(d.body, SANITIZE_OPTIONS)).toBe(d.body)
  })

  it('all three links (View + Claude + ChatGPT) survive sanitize-html byte-for-byte', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true, showChatgpt: true }, 'https://example.com')
    )
    expect(sanitizeHtml(d.body, SANITIZE_OPTIONS)).toBe(d.body)
  })

  it('markup with an adversarial slug still survives sanitize-html byte-for-byte', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('<script>"foo\'</script>')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx({ showClaude: true }, 'https://example.com')
    )
    expect(sanitizeHtml(d.body, SANITIZE_OPTIONS)).toBe(d.body)
  })

  it('custom prompt template with HTML-special characters still survives sanitize-html byte-for-byte', () => {
    const plugin = aiActionsPlugin()
    const post = makePost('hello-world')
    const [d] = plugin.publicHtmlForPost!(
      post,
      makeCtx(
        { showClaude: true, showChatgpt: true, promptTemplate: '<b>Read "{url}" & enjoy</b>' },
        'https://example.com'
      )
    )
    expect(sanitizeHtml(d.body, SANITIZE_OPTIONS)).toBe(d.body)
  })
})
