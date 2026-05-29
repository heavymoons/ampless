import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isValidElement, Fragment, type ReactElement } from 'react'
import {
  definePlugin,
  type Config,
  type PublicHeadDescriptor,
  type Post,
} from 'ampless'
import { createPluginHead, escapeJsonLdInlineBody } from './plugin-head.js'
import type { PluginSettingsApi, PluginSettingsSnapshot } from './plugin-settings.js'

// Stub `PluginSettingsApi` so tests run without S3 — every call
// returns the snapshot we hand in. `emptySettings` covers the
// majority of cases that don't exercise settings at all.
function makeSettings(snapshot: PluginSettingsSnapshot = new Map()): PluginSettingsApi {
  return {
    async loadAll() {
      return snapshot
    },
  }
}
const emptySettings = makeSettings()

const site: Config['site'] = {
  name: 'Test',
  url: 'https://example.com/',
}

function makeConfig(plugins: Config['plugins']): Config {
  return { site, plugins }
}

// Walk a rendered ReactNode (we always wrap output in a Fragment) into
// its array children so tests can assert on individual elements
// without depending on react-dom rendering.
function childrenOf(node: unknown): ReactElement[] {
  if (node === null || node === undefined) return []
  if (!isValidElement(node)) return []
  expect(node.type).toBe(Fragment)
  const children = (node.props as { children?: unknown }).children
  if (Array.isArray(children)) return children as ReactElement[]
  return children ? [children as ReactElement] : []
}

describe('createPluginHead', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns null when no plugins are registered', async () => {
    const head = createPluginHead(makeConfig([]), emptySettings)
    expect(await head.renderHead()).toBeNull()
    expect(await head.renderBodyEnd()).toBeNull()
  })

  it('renders both a script and an inline script for a single plugin', async () => {
    const plugin = definePlugin({
      name: 'demo',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead() {
        return [
          {
            type: 'script',
            id: 'demo-loader',
            src: 'https://cdn.example.com/loader.js',
            strategy: 'afterInteractive',
          },
          {
            type: 'inlineScript',
            id: 'demo-init',
            body: "console.log('hi')",
          },
        ] satisfies PublicHeadDescriptor[]
      },
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(2)
    expect(els[0]!.type).toBe('script')
    expect(els[0]!.props).toMatchObject({
      src: 'https://cdn.example.com/loader.js',
      id: 'demo-loader',
      async: true, // afterInteractive default → async
    })
    expect(els[1]!.type).toBe('script')
    expect(els[1]!.props).toMatchObject({
      id: 'demo-init',
      dangerouslySetInnerHTML: { __html: "console.log('hi')" },
    })
  })

  it('drops a script descriptor with a javascript: scheme and warns', async () => {
    const plugin = definePlugin({
      name: 'evil',
      apiVersion: 1,
      trust_level: 'untrusted',
      publicHead() {
        return [
          { type: 'script', id: 'evil', src: 'javascript:alert(1)' },
          {
            type: 'script',
            id: 'safe',
            src: 'https://cdn.example.com/ok.js',
          },
        ] satisfies PublicHeadDescriptor[]
      },
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.props).toMatchObject({ src: 'https://cdn.example.com/ok.js' })
    expect(warnSpy).toHaveBeenCalled()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('unsafe src "javascript:alert(1)"'))).toBe(true)
  })

  it('drops an inlineScript missing its id and warns', async () => {
    const plugin = definePlugin({
      name: 'no-id',
      apiVersion: 1,
      trust_level: 'untrusted',
      publicHead() {
        // Bypass the TS check by casting — at runtime plugins might
        // omit `id` even though the type forbids it.
        return [
          { type: 'inlineScript', body: 'x = 1' } as unknown as PublicHeadDescriptor,
        ]
      },
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    expect(await head.renderHead()).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('missing required "id"'))).toBe(true)
  })

  it('keeps the last descriptor when two share the same id and warns', async () => {
    const plugin = definePlugin({
      name: 'dupe',
      apiVersion: 1,
      trust_level: 'untrusted',
      publicHead() {
        return [
          {
            type: 'inlineScript',
            id: 'shared',
            body: '/* first */',
          },
          {
            type: 'inlineScript',
            id: 'shared',
            body: '/* second */',
          },
        ] satisfies PublicHeadDescriptor[]
      },
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect((els[0]!.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML.__html).toBe(
      '/* second */'
    )
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('duplicate descriptor id "shared"'))).toBe(true)
  })

  it('preserves cms.config.plugins order across multiple plugins', async () => {
    const a = definePlugin({
      name: 'a',
      apiVersion: 1,
      trust_level: 'untrusted',
      publicHead: () => [
        { type: 'meta', name: 'plugin', content: 'a' },
      ] satisfies PublicHeadDescriptor[],
    })
    const b = definePlugin({
      name: 'b',
      apiVersion: 1,
      trust_level: 'untrusted',
      publicHead: () => [
        { type: 'meta', name: 'plugin', content: 'b' },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([a, b]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(2)
    expect(els[0]!.props).toMatchObject({ content: 'a' })
    expect(els[1]!.props).toMatchObject({ content: 'b' })
  })

  it('warns once at construction time on duplicate plugin namespaces', () => {
    const p1 = definePlugin({
      name: 'ga4',
      apiVersion: 1,
      trust_level: 'untrusted',
      instanceId: 'shared',
    })
    const p2 = definePlugin({
      name: 'ga4',
      apiVersion: 1,
      trust_level: 'untrusted',
      instanceId: 'shared',
    })
    createPluginHead(makeConfig([p1, p2]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('duplicate plugin namespace "shared"'))).toBe(true)
  })

  it('warns when capabilities declare publicHead but no implementation exists', () => {
    const plugin = definePlugin({
      name: 'liar',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      // intentionally no publicHead
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('declares capability "publicHead" but no `publicHead` implementation'))
    ).toBe(true)
  })

  it('warns when publicHead is implemented but the capability is not declared', () => {
    const plugin = definePlugin({
      name: 'quiet',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['metadata'], // declares something else
      publicHead: () => [
        { type: 'meta', name: 'x', content: 'y' },
      ] satisfies PublicHeadDescriptor[],
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('implements `publicHead` but "publicHead" is not in declared capabilities'))
    ).toBe(true)
  })

  it('does not warn about capabilities when none are declared (legacy plugins)', () => {
    const plugin = definePlugin({
      name: 'legacy',
      apiVersion: 1,
      trust_level: 'untrusted',
      publicHead: () => [
        { type: 'meta', name: 'x', content: 'y' },
      ] satisfies PublicHeadDescriptor[],
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('not in declared capabilities'))
    ).toBe(false)
  })

  it('drops `nonce` from attrs (Phase 1 scopes nonce out, CSP RFP owns it)', async () => {
    const plugin = definePlugin({
      name: 'noncey',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [
        {
          type: 'script',
          id: 'with-nonce',
          src: 'https://cdn.example.com/x.js',
          attrs: { nonce: 'abc123', crossorigin: 'anonymous' },
        },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.props).toMatchObject({ crossorigin: 'anonymous' })
    expect(els[0]!.props).not.toHaveProperty('nonce')
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('attr "nonce" not in allowlist'))).toBe(true)
  })

  it('renders body-end iframe descriptors with allow-listed attrs', async () => {
    const plugin = definePlugin({
      name: 'gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicBody'],
      publicBodyEnd: () => [
        {
          type: 'iframe',
          id: 'gtm-fallback',
          src: 'https://www.googletagmanager.com/ns.html?id=GTM-XYZ',
          height: 0,
          width: 0,
          attrs: { sandbox: 'allow-scripts', 'data-tracking': 'gtm' },
        },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderBodyEnd())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('iframe')
    expect(els[0]!.props).toMatchObject({
      src: 'https://www.googletagmanager.com/ns.html?id=GTM-XYZ',
      sandbox: 'allow-scripts',
      'data-tracking': 'gtm',
    })
  })

  it('ctx.setting() falls back to manifest default when snapshot is empty', async () => {
    const plugin = definePlugin({
      name: 'ga4',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      settings: {
        public: [
          {
            type: 'text',
            key: 'measurementId',
            label: 'mid',
            pattern: '^$|^G-[A-Z0-9]+$',
            default: 'G-DEFAULT',
          },
        ],
      },
      publicHead(ctx) {
        const id = ctx.setting<string>('measurementId') ?? ''
        return id
          ? [
              {
                type: 'meta',
                name: 'ga4-id',
                content: id,
              },
            ]
          : []
      },
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.props).toMatchObject({ content: 'G-DEFAULT' })
  })

  it('ctx.setting() reads stored snapshot value over the default', async () => {
    const plugin = definePlugin({
      name: 'ga4',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      settings: {
        public: [
          {
            type: 'text',
            key: 'measurementId',
            label: 'mid',
            pattern: '^$|^G-[A-Z0-9]+$',
            default: 'G-DEFAULT',
          },
        ],
      },
      publicHead(ctx) {
        const id = ctx.setting<string>('measurementId') ?? ''
        return [{ type: 'meta', name: 'ga4-id', content: id }]
      },
    })
    const snapshot: PluginSettingsSnapshot = new Map([
      ['ga4', { measurementId: 'G-OVERRIDE' }],
    ])
    const head = createPluginHead(makeConfig([plugin]), makeSettings(snapshot))
    const els = childrenOf(await head.renderHead())
    expect(els[0]!.props).toMatchObject({ content: 'G-OVERRIDE' })
  })

  it('ctx.setting() returns empty string from stored snapshot (disable semantic)', async () => {
    // Critical: storing '' must NOT fall back to constructor default
    // — admin uses this to disable a plugin without rewriting
    // cms.config.ts. Mirrors the GA4 dogfood scenario in the spec.
    const plugin = definePlugin({
      name: 'ga4',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      settings: {
        public: [
          {
            type: 'text',
            key: 'measurementId',
            label: 'mid',
            pattern: '^$|^G-[A-Z0-9]+$',
            default: 'G-DEFAULT',
          },
        ],
      },
      publicHead(ctx) {
        const id = ctx.setting<string>('measurementId') ?? ''
        if (!id) return []
        return [{ type: 'meta', name: 'ga4-id', content: id }]
      },
    })
    const snapshot: PluginSettingsSnapshot = new Map([
      ['ga4', { measurementId: '' }],
    ])
    const head = createPluginHead(makeConfig([plugin]), makeSettings(snapshot))
    expect(await head.renderHead()).toBeNull()
  })

  it('drops plugins with invalid instanceId and warns', () => {
    const plugin = definePlugin({
      name: 'analytics',
      apiVersion: 1,
      trust_level: 'untrusted',
      instanceId: 'foo.bar',
      capabilities: ['publicHead'],
      publicHead: () => [
        { type: 'meta', name: 'x', content: 'y' },
      ] satisfies PublicHeadDescriptor[],
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('plugin namespace "foo.bar"'))
    ).toBe(true)
  })

  it('warns when settings.public field key violates pattern', () => {
    const plugin = definePlugin({
      name: 'demo',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      settings: {
        public: [
          {
            type: 'text',
            key: 'bad.key',
            label: 'b',
            default: 'v',
          },
        ],
      },
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('settings.public field key "bad.key"'))
    ).toBe(true)
  })

  it('passes the same ctx.setting bindings to both publicHead and publicBodyEnd', async () => {
    const seen: string[] = []
    const plugin = definePlugin({
      name: 'both',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'publicBody'],
      settings: {
        public: [
          { type: 'text', key: 'k', label: 'k', default: 'D' },
        ],
      },
      publicHead(ctx) {
        seen.push(`head:${ctx.setting<string>('k')}`)
        return []
      },
      publicBodyEnd(ctx) {
        seen.push(`body:${ctx.setting<string>('k')}`)
        return []
      },
    })
    const snapshot: PluginSettingsSnapshot = new Map([['both', { k: 'V' }]])
    const head = createPluginHead(makeConfig([plugin]), makeSettings(snapshot))
    await head.renderHead()
    await head.renderBodyEnd()
    expect(seen).toEqual(['head:V', 'body:V'])
  })

  // ---------------------------------------------------------------------------
  // renderBodyForPost — Phase 4 'schema' capability
  // ---------------------------------------------------------------------------

  describe('renderBodyForPost(post)', () => {
    const samplePost: Post = {
      postId: 'p1',
      slug: 'hello',
      title: 'Hello',
      format: 'markdown',
      body: '',
      status: 'published',
    }

    it('returns null when no plugins implement publicBodyForPost', async () => {
      const plugin = definePlugin({
        name: 'no-body',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['publicHead'],
        publicHead: () => [],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      expect(await head.renderBodyForPost(samplePost)).toBeNull()
    })

    it('renders a descriptor returned by publicBodyForPost', async () => {
      const plugin = definePlugin({
        name: 'schema',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost(_post, _ctx) {
          return [
            {
              type: 'inlineScript',
              id: 'schema-article',
              scriptType: 'application/ld+json' as const,
              body: '{"@context":"https://schema.org","@type":"Article"}',
            },
          ]
        },
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      const els = childrenOf(await head.renderBodyForPost(samplePost))
      expect(els).toHaveLength(1)
      expect(els[0]!.type).toBe('script')
      expect(els[0]!.props).toMatchObject({
        id: 'schema-article',
        type: 'application/ld+json',
      })
    })

    it('passes post as the first argument to publicBodyForPost', async () => {
      const receivedPosts: Post[] = []
      const plugin = definePlugin({
        name: 'schema',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost(post, _ctx) {
          receivedPosts.push(post)
          return [
            {
              type: 'inlineScript',
              id: 'schema-check',
              scriptType: 'application/ld+json' as const,
              body: '{}',
            },
          ]
        },
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      await head.renderBodyForPost(samplePost)
      expect(receivedPosts).toHaveLength(1)
      expect(receivedPosts[0]).toBe(samplePost)
    })

    it('ctx.setting() works inside publicBodyForPost', async () => {
      const seenSettings: (string | undefined)[] = []
      const plugin = definePlugin({
        name: 'schema',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema', 'adminSettings'],
        settings: {
          public: [
            { type: 'text', key: 'articleType', label: 'Article type', default: 'Article' },
          ],
        },
        publicBodyForPost(_post, ctx) {
          seenSettings.push(ctx.setting<string>('articleType'))
          return [
            {
              type: 'inlineScript',
              id: 'schema-type',
              scriptType: 'application/ld+json' as const,
              body: '{}',
            },
          ]
        },
      })
      const snapshot: PluginSettingsSnapshot = new Map([
        ['schema', { articleType: 'BlogPosting' }],
      ])
      const head = createPluginHead(makeConfig([plugin]), makeSettings(snapshot))
      await head.renderBodyForPost(samplePost)
      expect(seenSettings).toEqual(['BlogPosting'])
    })

    it('aggregates multiple plugins and last-wins on duplicate id', async () => {
      const pluginA = definePlugin({
        name: 'schema-a',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost(_post, _ctx) {
          return [
            {
              type: 'inlineScript',
              id: 'shared-schema',
              scriptType: 'application/ld+json' as const,
              body: '{"source":"a"}',
            },
          ]
        },
      })
      const pluginB = definePlugin({
        name: 'schema-b',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost(_post, _ctx) {
          return [
            {
              type: 'inlineScript',
              id: 'shared-schema',
              scriptType: 'application/ld+json' as const,
              body: '{"source":"b"}',
            },
          ]
        },
      })
      const head = createPluginHead(makeConfig([pluginA, pluginB]), emptySettings)
      const els = childrenOf(await head.renderBodyForPost(samplePost))
      expect(els).toHaveLength(1)
      const html = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
        .dangerouslySetInnerHTML.__html
      // last wins → source "b"
      expect(JSON.parse(html)).toMatchObject({ source: 'b' })
    })
  })

  // ---------------------------------------------------------------------------
  // scriptType policy per surface
  // ---------------------------------------------------------------------------

  describe('scriptType policy', () => {
    const samplePost: Post = {
      postId: 'p2',
      slug: 'test',
      title: 'Test',
      format: 'markdown',
      body: '',
      status: 'published',
    }

    it('publicHead: undefined scriptType (default JS) is rendered', async () => {
      const plugin = definePlugin({
        name: 'js-head',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['publicHead'],
        publicHead: () => [
          { type: 'inlineScript', id: 'init', body: 'console.log("hi")' },
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      const els = childrenOf(await head.renderHead())
      expect(els).toHaveLength(1)
      expect(els[0]!.props).not.toHaveProperty('type')
    })

    it('publicHead: application/ld+json is rendered with auto-escape', async () => {
      const plugin = definePlugin({
        name: 'jsonld-head',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['publicHead'],
        publicHead: () => [
          {
            type: 'inlineScript',
            id: 'schema-head',
            scriptType: 'application/ld+json' as const,
            body: '{"x":"</script>"}',
          },
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      const els = childrenOf(await head.renderHead())
      expect(els).toHaveLength(1)
      expect(els[0]!.props).toMatchObject({ type: 'application/ld+json' })
      const html = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
        .dangerouslySetInnerHTML.__html
      expect(html).not.toContain('</script>')
    })

    it('publicHead: unsupported scriptType is dropped and warns', async () => {
      const plugin = definePlugin({
        name: 'bad-type-head',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['publicHead'],
        publicHead: () => [
          // bypass TS check — simulate a plugin returning an invalid scriptType
          {
            type: 'inlineScript',
            id: 'bad-type',
            scriptType: 'application/javascript',
            body: 'alert(1)',
          } as unknown as PublicHeadDescriptor,
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      expect(await head.renderHead()).toBeNull()
      const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      expect(messages.some((m: string) => m.includes('scriptType') && m.includes('not allowed'))).toBe(true)
    })

    it('publicBodyForPost: undefined scriptType is dropped and warns', async () => {
      const plugin = definePlugin({
        name: 'schema-no-type',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        // Return a descriptor with no scriptType (TS would reject; cast to bypass)
        publicBodyForPost: (_post, _ctx) => [
          {
            type: 'inlineScript',
            id: 'no-type',
            body: '{}',
          } as unknown as import('ampless').PublicPostBodyDescriptor,
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      expect(await head.renderBodyForPost(samplePost)).toBeNull()
      const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      expect(
        messages.some((m: string) => m.includes('scriptType') && m.includes('not allowed'))
      ).toBe(true)
    })

    it('publicBodyForPost: application/ld+json is rendered with auto-escape', async () => {
      const plugin = definePlugin({
        name: 'schema-escape',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost: (_post, _ctx) => [
          {
            type: 'inlineScript',
            id: 'schema-body',
            scriptType: 'application/ld+json' as const,
            body: '{"x":"</script>"}',
          },
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      const els = childrenOf(await head.renderBodyForPost(samplePost))
      expect(els).toHaveLength(1)
      const html = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
        .dangerouslySetInnerHTML.__html
      expect(html).not.toContain('</script>')
    })
  })

  // ---------------------------------------------------------------------------
  // JSON-LD escape cross-surface
  // ---------------------------------------------------------------------------

  describe('JSON-LD escape applies on all surfaces', () => {
    const jsonldBody = '{"x":"</script><img src=x>"}'
    const samplePost: Post = {
      postId: 'p3',
      slug: 'xss',
      title: 'XSS',
      format: 'markdown',
      body: '',
      status: 'published',
    }

    it('publicHead with application/ld+json escapes </script>', async () => {
      const plugin = definePlugin({
        name: 'esc-head',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['publicHead'],
        publicHead: () => [
          {
            type: 'inlineScript',
            id: 'esc-head-schema',
            scriptType: 'application/ld+json' as const,
            body: jsonldBody,
          },
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      const els = childrenOf(await head.renderHead())
      const html = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
        .dangerouslySetInnerHTML.__html
      expect(html).not.toContain('</script>')
    })

    it('publicBodyForPost with application/ld+json escapes </script>', async () => {
      const plugin = definePlugin({
        name: 'esc-body',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost: (_post, _ctx) => [
          {
            type: 'inlineScript',
            id: 'esc-body-schema',
            scriptType: 'application/ld+json' as const,
            body: jsonldBody,
          },
        ],
      })
      const head = createPluginHead(makeConfig([plugin]), emptySettings)
      const els = childrenOf(await head.renderBodyForPost(samplePost))
      const html = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
        .dangerouslySetInnerHTML.__html
      expect(html).not.toContain('</script>')
    })
  })

  // ---------------------------------------------------------------------------
  // capability mismatch: 'schema' ↔ publicBodyForPost
  // ---------------------------------------------------------------------------

  describe('capability mismatch: schema ↔ publicBodyForPost', () => {
    it('warns when schema declared but publicBodyForPost not implemented', () => {
      const plugin = definePlugin({
        name: 'schema-decl-only',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        // intentionally no publicBodyForPost
      })
      createPluginHead(makeConfig([plugin]), emptySettings)
      const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      expect(
        messages.some(
          (m: string) =>
            m.includes('declares capability "schema"') &&
            m.includes('publicBodyForPost')
        )
      ).toBe(true)
    })

    it('warns when publicBodyForPost implemented but schema not declared', () => {
      const plugin = definePlugin({
        name: 'schema-impl-only',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['adminSettings'], // declares something else but not 'schema'
        publicBodyForPost: (_post, _ctx) => [
          {
            type: 'inlineScript',
            id: 'schema-x',
            scriptType: 'application/ld+json' as const,
            body: '{}',
          },
        ],
      })
      createPluginHead(makeConfig([plugin]), emptySettings)
      const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      expect(
        messages.some(
          (m: string) =>
            m.includes('publicBodyForPost') &&
            m.includes('"schema"') &&
            m.includes('not in declared capabilities')
        )
      ).toBe(true)
    })

    it('does not warn when both schema declared and publicBodyForPost implemented', () => {
      const plugin = definePlugin({
        name: 'schema-both',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['schema'],
        publicBodyForPost: (_post, _ctx) => [
          {
            type: 'inlineScript',
            id: 'schema-ok',
            scriptType: 'application/ld+json' as const,
            body: '{}',
          },
        ],
      })
      createPluginHead(makeConfig([plugin]), emptySettings)
      const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      const schemaWarn = messages.some(
        (m: string) => m.includes('schema') && m.includes('publicBodyForPost')
      )
      expect(schemaWarn).toBe(false)
    })

    it('does not warn when neither schema nor publicBodyForPost is present', () => {
      const plugin = definePlugin({
        name: 'no-schema',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['publicHead'],
        publicHead: () => [],
      })
      createPluginHead(makeConfig([plugin]), emptySettings)
      const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      const schemaWarn = messages.some(
        (m: string) => m.includes('schema') && m.includes('publicBodyForPost')
      )
      expect(schemaWarn).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// escapeJsonLdInlineBody — unit tests
// ---------------------------------------------------------------------------

describe('escapeJsonLdInlineBody', () => {
  it('escapes < to \\u003c', () => {
    expect(escapeJsonLdInlineBody('<')).toBe('\\u003c')
  })

  it('escapes > to \\u003e', () => {
    expect(escapeJsonLdInlineBody('>')).toBe('\\u003e')
  })

  it('escapes & to \\u0026', () => {
    expect(escapeJsonLdInlineBody('&')).toBe('\\u0026')
  })

  it('escapes U+2028 (line separator) to \\u2028', () => {
    expect(escapeJsonLdInlineBody(' ')).toBe('\\u2028')
  })

  it('escapes U+2029 (paragraph separator) to \\u2029', () => {
    expect(escapeJsonLdInlineBody(' ')).toBe('\\u2029')
  })

  it('leaves ordinary strings unchanged', () => {
    const s = '{"@context":"https://schema.org","@type":"Article","headline":"Hello World"}'
    expect(escapeJsonLdInlineBody(s)).toBe(s)
  })

  it('produces a string that JSON.parse can still parse', () => {
    const original = JSON.stringify({
      headline: 'Hello <World> & "foo"',
      url: 'https://example.com/?a=1&b=2',
    })
    const escaped = escapeJsonLdInlineBody(original)
    expect(() => JSON.parse(escaped)).not.toThrow()
    const parsed = JSON.parse(escaped) as Record<string, string>
    expect(parsed.headline).toBe('Hello <World> & "foo"')
  })

  it('removes </script> injection risk from the escaped output', () => {
    const malicious = '{"x":"</script><img src=x onerror=alert(1)>"}'
    const escaped = escapeJsonLdInlineBody(malicious)
    expect(escaped).not.toContain('</script>')
    // still parseable
    expect(() => JSON.parse(escaped)).not.toThrow()
  })
})
