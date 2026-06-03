import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isValidElement, Fragment, type ReactElement, type ReactNode } from 'react'
import {
  definePlugin,
  type Config,
  type PublicHeadDescriptor,
  type PublicPostHtmlDescriptor,
  type Post,
} from 'ampless'
import { createPluginHead, escapeJsonLdInlineBody } from './plugin-head.js'
import type { PluginSettingsApi, PluginSettingsSnapshot } from './plugin-settings.js'
import type { PluginPackageManifest } from 'ampless'

// ---------------------------------------------------------------------------
// Module-level mock for plugin-package-manifest so crossCheckStaticManifest
// tests can control what loadPackageManifest returns without touching the
// real filesystem or requiring plugin packages in node_modules.
// vi.mock calls are hoisted before imports by vitest's transform step.
// ---------------------------------------------------------------------------
vi.mock('./plugin-package-manifest.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./plugin-package-manifest.js')>()
  return {
    ...real,
    loadPackageManifest: vi.fn(() => null), // default: no manifest (silent skip)
  }
})

import { loadPackageManifest } from './plugin-package-manifest.js'
const mockedLoadPackageManifest = vi.mocked(loadPackageManifest)

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

// ---------------------------------------------------------------------------
// crossCheckStaticManifest — called by createPluginHead constructor when
// plugin.packageName is set. loadPackageManifest is mocked at the module
// level (vi.mock above) so tests control what the manifest returns without
// hitting the real filesystem.
// ---------------------------------------------------------------------------

describe('crossCheckStaticManifest (via createPluginHead)', () => {
  // GTM manifest as declared in @ampless/plugin-gtm/package.json
  const gtmManifest: PluginPackageManifest = {
    apiVersion: 1,
    name: 'gtm',
    trustLevel: 'untrusted',
    capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    displayName: { en: 'Google Tag Manager', ja: 'Google Tag Manager' },
  }

  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Default: no manifest (silent skip). Individual tests override as needed.
    mockedLoadPackageManifest.mockReturnValue(null)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.mocked(mockedLoadPackageManifest).mockReset()
  })

  it('case 1: no packageName → cross-check not called, no throw or extra warn', () => {
    // A plugin without packageName skips cross-check entirely. The
    // createPluginHead constructor should complete without calling
    // loadPackageManifest and without any capability-mismatch warns
    // (since capabilities match the implementation).
    const plugin = definePlugin({
      name: 'no-pkg',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    expect(mockedLoadPackageManifest).not.toHaveBeenCalled()
  })

  it('case 2: packageName set, manifest matches factory → cross-check passes silently', () => {
    // Full match: apiVersion / name / trustLevel / capabilities all agree.
    mockedLoadPackageManifest.mockReturnValue(gtmManifest)
    const plugin = definePlugin({
      name: 'gtm',
      packageName: '@ampless/plugin-gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    // loadPackageManifest must have been called with the plugin's packageName
    expect(mockedLoadPackageManifest).toHaveBeenCalledWith('@ampless/plugin-gtm')
    // No cross-check warn should have been emitted
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const crossCheckWarns = messages.filter((m: string) =>
      m.includes('apiVersion') ||
      m.includes('name mismatch') ||
      m.includes('trustLevel') ||
      m.includes('capabilities mismatch')
    )
    expect(crossCheckWarns).toHaveLength(0)
  })

  it('case 3: apiVersion mismatch (factory declares future version) → throws', () => {
    // manifest.apiVersion === 1 but factory.apiVersion === 99 → mismatch throw.
    mockedLoadPackageManifest.mockReturnValue({ ...gtmManifest, apiVersion: 1 as const })
    const plugin = definePlugin({
      name: 'gtm',
      packageName: '@ampless/plugin-gtm',
      apiVersion: 99 as 1, // cast to satisfy TS, simulating a future plugin
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).toThrow(
      /apiVersion mismatch/
    )
  })

  it('case 3b: manifest.apiVersion above SUPPORTED_API_VERSION → throws', () => {
    // manifest claims apiVersion 2 but SUPPORTED_API_VERSION is 1 → throw.
    mockedLoadPackageManifest.mockReturnValue({
      ...gtmManifest,
      apiVersion: 2 as unknown as 1,
    })
    const plugin = definePlugin({
      name: 'gtm',
      packageName: '@ampless/plugin-gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).toThrow(
      /newer than this runtime supports/
    )
  })

  it('case 4: name mismatch → warns, does not throw', () => {
    mockedLoadPackageManifest.mockReturnValue({ ...gtmManifest, name: 'google-tag-manager' })
    const plugin = definePlugin({
      name: 'gtm', // factory says 'gtm', manifest says 'google-tag-manager'
      packageName: '@ampless/plugin-gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('name mismatch'))).toBe(true)
  })

  it('case 5: capabilities mismatch (factory subset of manifest) → warns, does not throw', () => {
    // manifest declares 3 capabilities; factory only declares 1 → mismatch.
    mockedLoadPackageManifest.mockReturnValue(gtmManifest)
    const plugin = definePlugin({
      name: 'gtm',
      packageName: '@ampless/plugin-gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'], // manifest has 3
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('capabilities mismatch'))).toBe(true)
  })

  it('case 6: packageName set but loadPackageManifest returns null → silent skip, no warn or throw', () => {
    // Simulates a plugin whose package.json isn't exported or has no
    // amplessPlugin field. loadPackageManifest returns null → the helper
    // returns early without checking anything.
    mockedLoadPackageManifest.mockReturnValue(null)
    const plugin = definePlugin({
      name: 'gtm',
      packageName: 'this-package-does-not-exist',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    // No cross-check warnings
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const crossCheckWarns = messages.filter((m: string) =>
      m.includes('apiVersion') ||
      m.includes('name mismatch') ||
      m.includes('trustLevel') ||
      m.includes('capabilities mismatch')
    )
    expect(crossCheckWarns).toHaveLength(0)
  })

  // Defensive: even if a malformed manifest somehow reaches
  // crossCheckStaticManifest (e.g. through a future code path that
  // bypasses loadPackageManifest's structural validation), iterating
  // its capabilities must not throw. The downstream setsEqual loop
  // uses Set construction, which handles any iterable; the upstream
  // Array.isArray guard on the factory side covers the other axis.
  it('case 7: capabilities with duplicates → treated as equal sets, no false-positive warn', () => {
    // Manifest declares the same capability twice; factory declares it once.
    // The set comparison should treat them as equal.
    mockedLoadPackageManifest.mockReturnValue({
      ...gtmManifest,
      capabilities: ['publicHead', 'publicHead', 'publicBody', 'adminSettings'],
    })
    const plugin = definePlugin({
      name: 'gtm',
      packageName: '@ampless/plugin-gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('capabilities mismatch'))
    ).toBe(false)
  })

  it('case 8: factory capabilities undefined → treated as empty array (no crash)', () => {
    // Factory omits the `capabilities` field entirely. The Array.isArray
    // guard in crossCheckStaticManifest must convert it to []; the
    // mismatch warning still fires against the manifest's 3 caps.
    mockedLoadPackageManifest.mockReturnValue(gtmManifest)
    const plugin = definePlugin({
      name: 'gtm',
      packageName: '@ampless/plugin-gtm',
      apiVersion: 1,
      trust_level: 'untrusted',
      // capabilities omitted on purpose
    })
    expect(() => createPluginHead(makeConfig([plugin]), emptySettings)).not.toThrow()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('capabilities mismatch'))
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phase 6d — publicHtmlForPost
// ---------------------------------------------------------------------------

describe('renderHtmlForPost(post) — Phase 6d', () => {
  const samplePost: Post = {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    format: 'markdown',
    body: '',
    status: 'published',
  }

  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  // Build a plugin that returns one descriptor with a custom body / id / position.
  function htmlPlugin(opts: {
    name?: string
    instanceId?: string
    descriptors: readonly PublicPostHtmlDescriptor[]
    capabilities?: ('publicHtmlForPost' | 'publicHead' | 'schema')[]
  }) {
    return definePlugin({
      name: opts.name ?? 'reading-time',
      ...(opts.instanceId ? { instanceId: opts.instanceId } : {}),
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: opts.capabilities ?? ['publicHtmlForPost'],
      publicHtmlForPost() {
        return opts.descriptors
      },
    })
  }

  // Helpers ------------------------------------------------------------------

  // Pull the sanitized __html out of a position result. The aggregator
  // wraps entries in <Fragment><div ... dangerouslySetInnerHTML /></Fragment>.
  function htmlsOf(node: ReactNode | null): string[] {
    if (node === null || node === undefined) return []
    if (!isValidElement(node)) return []
    expect(node.type).toBe(Fragment)
    const children = (node.props as { children?: unknown }).children
    const arr = Array.isArray(children)
      ? (children as ReactElement[])
      : children
        ? [children as ReactElement]
        : []
    return arr.map((el) => {
      const props = el.props as { dangerouslySetInnerHTML?: { __html: string } }
      return props.dangerouslySetInnerHTML?.__html ?? ''
    })
  }

  function divsOf(node: ReactNode | null): ReactElement[] {
    if (node === null || node === undefined) return []
    if (!isValidElement(node)) return []
    expect(node.type).toBe(Fragment)
    const children = (node.props as { children?: unknown }).children
    const arr = Array.isArray(children)
      ? (children as ReactElement[])
      : children
        ? [children as ReactElement]
        : []
    return arr
  }

  // Sanitize: dangerous content removal --------------------------------------

  it('drops <script> tags', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<p>ok</p><script>alert(1)</script>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    const [html] = htmlsOf(beforeContent)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips inline style attribute', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<p style="color:red">x</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('style')
    expect(html).toContain('<p')
  })

  it('strips inline event handlers (onclick)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<p onclick="evil()">x</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('evil')
  })

  it('drops <img> tags', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<p>ok</p><img src=x>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('<img')
  })

  it('drops <iframe> tags', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<iframe src="x"></iframe>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('<iframe')
  })

  it('drops <style> tags', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<style>body{display:none}</style><p>ok</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('<style')
    expect(html).not.toContain('display:none')
  })

  // Sanitize: URL allow/deny -------------------------------------------------

  it('drops <a href="javascript:..."> (scheme not in allowlist)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="javascript:alert(1)">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('javascript:')
  })

  it('drops <a href="data:..."> (scheme not in allowlist)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="data:text/html,x">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('data:')
  })

  it('drops <a href="mailto:..."> (scheme not in allowlist)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="mailto:x@x.com">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('mailto:')
  })

  it('drops <a href="tel:..."> (scheme not in allowlist)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="tel:+1234">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).not.toContain('tel:')
  })

  it('keeps <a href="https://..."> (https allowed)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="https://example.com">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('href="https://example.com"')
  })

  it('keeps <a href="/path"> (absolute internal)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="/path">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('href="/path"')
  })

  it('keeps <a href="./path"> (relative)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="./path">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('href="./path"')
  })

  it('keeps <a href="../path"> (relative parent)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="../path">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('href="../path"')
  })

  it('keeps <a href="#anchor"> (hash)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="#anchor">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('href="#anchor"')
  })

  // Sanitize: rel transform on target="_blank" -------------------------------

  it('adds rel="noopener noreferrer" when target="_blank" and no rel', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'd', position: 'beforeContent', body: '<a href="https://x.com" target="_blank">x</a>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('noopener')
    expect(html).toContain('noreferrer')
  })

  it('does not duplicate noopener when target="_blank" rel="noopener" already set', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        {
          type: 'html',
          id: 'd',
          position: 'beforeContent',
          body: '<a href="https://x.com" target="_blank" rel="noopener">x</a>',
        },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    // Should contain exactly one 'noopener'
    expect(html.match(/noopener/g)?.length).toBe(1)
    expect(html).toContain('noreferrer')
  })

  // Sanitize: allowed attribute pass-through ---------------------------------

  it('keeps class / data-words / data-minutes / data-ampless-* attributes', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        {
          type: 'html',
          id: 'd',
          position: 'beforeContent',
          body: '<p class="reading-time" data-words="100" data-minutes="3" data-ampless-foo="y">x</p>',
        },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [html] = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(html).toContain('class="reading-time"')
    expect(html).toContain('data-words="100"')
    expect(html).toContain('data-minutes="3"')
    expect(html).toContain('data-ampless-foo="y"')
  })

  // Descriptor shape validation ----------------------------------------------
  //
  // The type narrows the descriptor to PublicPostHtmlDescriptor, but a JS
  // plugin or one that uses unsafe casts can hand us anything. Without the
  // shape guard, the subsequent validateHtmlId / sanitizeHtml calls would
  // throw TypeError and the post page render would fail open. Each of
  // these cases must drop + warn, not throw.

  it('drops non-object descriptor (null) and warns', async () => {
    const plugin = htmlPlugin({
      // Cast: pretend the plugin handed us a null where a descriptor was expected.
      descriptors: [null as unknown as PublicPostHtmlDescriptor],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent, afterContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    expect(afterContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('must be an object'))).toBe(true)
  })

  it('drops descriptor with wrong type field and warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'script', id: 'display', position: 'beforeContent', body: '<p>x</p>' } as unknown as PublicPostHtmlDescriptor,
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('"type" must be "html"'))).toBe(true)
  })

  it('drops descriptor with non-string id (undefined) and warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: undefined, position: 'beforeContent', body: '<p>x</p>' } as unknown as PublicPostHtmlDescriptor,
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('"id" must be a string'))).toBe(true)
  })

  it('drops descriptor with non-string body (undefined) and warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'display', position: 'beforeContent', body: undefined } as unknown as PublicPostHtmlDescriptor,
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('"body" must be a string'))).toBe(true)
  })

  it('drops descriptor with unknown position ("sidebar") rather than mis-bucketing it', async () => {
    // Regression: before runtime shape validation the position field was
    // trusted blindly, and any non-"beforeContent" value silently fell into
    // the afterContent bucket. Now invalid positions are rejected outright.
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'display', position: 'sidebar', body: '<p>x</p>' } as unknown as PublicPostHtmlDescriptor,
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent, afterContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    expect(afterContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('"position" must be'))).toBe(true)
  })

  it('drops malformed descriptor but keeps the valid sibling in the same array', async () => {
    // Ensures one bad descriptor doesn't poison the whole publicHtmlForPost
    // return value from a single plugin.
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'broken', position: 'sidebar', body: '<p>bad</p>' } as unknown as PublicPostHtmlDescriptor,
        { type: 'html', id: 'good', position: 'beforeContent', body: '<p>ok</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    const els = divsOf(beforeContent)
    expect(els).toHaveLength(1)
    const html = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
      .dangerouslySetInnerHTML.__html
    expect(html).toContain('<p>ok</p>')
  })

  // id validation ------------------------------------------------------------

  it('drops descriptor with empty id and warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [{ type: 'html', id: '', position: 'beforeContent', body: '<p>x</p>' }],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('"id" must not be empty'))).toBe(true)
  })

  it('drops descriptor with control character in id and warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [{ type: 'html', id: 'a\x00b', position: 'beforeContent', body: '<p>x</p>' }],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('control characters'))).toBe(true)
  })

  it('drops descriptor with id longer than 64 chars and warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [{ type: 'html', id: 'a'.repeat(65), position: 'beforeContent', body: '<p>x</p>' }],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(beforeContent).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('exceeds 64'))).toBe(true)
  })

  it('accepts valid id ("display")', async () => {
    const plugin = htmlPlugin({
      descriptors: [{ type: 'html', id: 'display', position: 'beforeContent', body: '<p>x</p>' }],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    const els = divsOf(beforeContent)
    expect(els).toHaveLength(1)
  })

  // Dedupe / namespace -------------------------------------------------------

  it('drops second descriptor with same id from same plugin instance + warns', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'display', position: 'beforeContent', body: '<p>first</p>' },
        { type: 'html', id: 'display', position: 'beforeContent', body: '<p>second</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const htmls = htmlsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(htmls).toHaveLength(1)
    expect(htmls[0]).toContain('first')
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('duplicate'))).toBe(true)
  })

  it('keeps same id from two different namespaces (instanceId disambiguates)', async () => {
    const a = htmlPlugin({
      name: 'reading-time',
      instanceId: 'reading-time-en',
      descriptors: [{ type: 'html', id: 'display', position: 'beforeContent', body: '<p>en</p>' }],
    })
    const b = htmlPlugin({
      name: 'reading-time',
      instanceId: 'reading-time-jp',
      descriptors: [{ type: 'html', id: 'display', position: 'beforeContent', body: '<p>jp</p>' }],
    })
    const head = createPluginHead(makeConfig([a, b]), emptySettings)
    const els = divsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(els).toHaveLength(2)
    expect(els[0]!.key).toBe('reading-time-en:display')
    expect(els[1]!.key).toBe('reading-time-jp:display')
  })

  it('keeps same id across different positions (dedupe scope is per-position)', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'display', position: 'beforeContent', body: '<p>before</p>' },
        { type: 'html', id: 'display', position: 'afterContent', body: '<p>after</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const result = await head.renderHtmlForPost(samplePost)
    expect(htmlsOf(result.beforeContent)).toHaveLength(1)
    expect(htmlsOf(result.afterContent)).toHaveLength(1)
  })

  // Aggregation --------------------------------------------------------------

  it('isolates a plugin that throws — other plugins still render', async () => {
    const bad = definePlugin({
      name: 'bad',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHtmlForPost'],
      publicHtmlForPost() {
        throw new Error('boom')
      },
    })
    const good = htmlPlugin({
      name: 'good',
      descriptors: [{ type: 'html', id: 'd', position: 'beforeContent', body: '<p>ok</p>' }],
    })
    const head = createPluginHead(makeConfig([bad, good]), emptySettings)
    const { beforeContent } = await head.renderHtmlForPost(samplePost)
    expect(htmlsOf(beforeContent)).toHaveLength(1)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('threw inside publicHtmlForPost'))).toBe(true)
  })

  it('returns both slots null when no descriptors contributed', async () => {
    const head = createPluginHead(makeConfig([]), emptySettings)
    const result = await head.renderHtmlForPost(samplePost)
    expect(result.beforeContent).toBeNull()
    expect(result.afterContent).toBeNull()
  })

  it('returns beforeContent only when no afterContent descriptors', async () => {
    const plugin = htmlPlugin({
      descriptors: [{ type: 'html', id: 'd', position: 'beforeContent', body: '<p>x</p>' }],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const result = await head.renderHtmlForPost(samplePost)
    expect(result.beforeContent).not.toBeNull()
    expect(result.afterContent).toBeNull()
  })

  it('returns both slots populated when both positions have descriptors', async () => {
    const plugin = htmlPlugin({
      descriptors: [
        { type: 'html', id: 'a', position: 'beforeContent', body: '<p>before</p>' },
        { type: 'html', id: 'b', position: 'afterContent', body: '<p>after</p>' },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const result = await head.renderHtmlForPost(samplePost)
    expect(htmlsOf(result.beforeContent)).toHaveLength(1)
    expect(htmlsOf(result.afterContent)).toHaveLength(1)
  })

  // Wrapper element shape ----------------------------------------------------

  it('wraps each entry in a <div> with data-ampless-plugin + data-ampless-position', async () => {
    const plugin = htmlPlugin({
      name: 'reading-time',
      descriptors: [{ type: 'html', id: 'display', position: 'beforeContent', body: '<p>x</p>' }],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const [el] = divsOf((await head.renderHtmlForPost(samplePost)).beforeContent)
    expect(el!.type).toBe('div')
    const props = el!.props as Record<string, string>
    expect(props['data-ampless-plugin']).toBe('reading-time')
    expect(props['data-ampless-position']).toBe('beforeContent')
  })

  // Capability mismatch ------------------------------------------------------

  it('warns when publicHtmlForPost implemented but capability not declared', () => {
    const plugin = definePlugin({
      name: 'reading-time',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'], // intentionally missing 'publicHtmlForPost'
      publicHtmlForPost() {
        return []
      },
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some(
        (m: string) =>
          m.includes('implements `publicHtmlForPost`') &&
          m.includes('not in declared capabilities')
      )
    ).toBe(true)
  })

  it('warns when capability declared but publicHtmlForPost not implemented', () => {
    const plugin = definePlugin({
      name: 'reading-time',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHtmlForPost'],
      // intentionally no publicHtmlForPost
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some(
        (m: string) =>
          m.includes('declares capability "publicHtmlForPost"') &&
          m.includes('no `publicHtmlForPost` implementation')
      )
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// noscript descriptor — raw HTML passthrough regression tests
//
// These tests pin the CURRENT SPEC: noscript content is trusted raw HTML
// emitted via dangerouslySetInnerHTML, with no sanitization applied by the
// runtime. The noscript variant is an intentional escape hatch for vendor-
// supplied analytics fallbacks and similar content that cannot be modelled
// as typed props.
//
// If we ever decide to sanitize noscript content, these tests become the
// deliberate trigger to update — a failing test here means the change is
// intentional and reviewed.
// ---------------------------------------------------------------------------

describe('noscript descriptor — raw HTML passthrough (current spec)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('renders analytics fallback noscript via dangerouslySetInnerHTML', async () => {
    // test 1: normal analytics fallback (e.g. GTM noscript pixel) renders correctly
    const plugin = definePlugin({
      name: 'analytics',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [
        {
          type: 'noscript',
          id: 'analytics-fallback',
          html: '<img src="https://example.com/track.gif" width="1" height="1" alt="">',
        },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('noscript')
    expect(els[0]!.props).toMatchObject({
      id: 'analytics-fallback',
      dangerouslySetInnerHTML: {
        __html: '<img src="https://example.com/track.gif" width="1" height="1" alt="">',
      },
    })
  })

  it('passes </noscript> breakout string through unmodified — documents current trusted-passthrough spec', async () => {
    // test 2: This documents the current spec — noscript content is trusted raw
    // HTML. If we ever decide to sanitize, this test becomes the deliberate
    // trigger to update. The runtime does NOT escape or strip the breakout
    // sequence; plugin authors are responsible for the HTML being well-formed.
    const breakoutHtml = '</noscript><script>alert(1)</script>'
    const plugin = definePlugin({
      name: 'breakout-demo',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [
        {
          type: 'noscript',
          id: 'breakout-demo',
          html: breakoutHtml,
        },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    // The runtime passes the string through as-is — dangerouslySetInnerHTML
    // receives the original string with no modification.
    const innerHtml = (els[0]!.props as { dangerouslySetInnerHTML: { __html: string } })
      .dangerouslySetInnerHTML.__html
    expect(innerHtml).toBe(breakoutHtml)
  })

  it('renders <noscript></noscript> when html is empty string', async () => {
    // test 3: empty html produces a noscript element with empty content
    const plugin = definePlugin({
      name: 'empty-noscript',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [
        {
          type: 'noscript',
          html: '',
        },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('noscript')
    expect(els[0]!.props).toMatchObject({
      dangerouslySetInnerHTML: { __html: '' },
    })
  })

  it('renders noscript descriptor from publicBodyEnd as well', async () => {
    // PublicBodyDescriptor re-uses the noscript variant from PublicHeadDescriptor
    // via Extract — same passthrough behaviour applies.
    const plugin = definePlugin({
      name: 'gtm-noscript',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicBody'],
      publicBodyEnd: () => [
        {
          type: 'noscript',
          id: 'gtm-body-noscript',
          html: '<img src="https://www.googletagmanager.com/ns.html?id=GTM-XYZ" height="0" width="0" alt="">',
        },
      ],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderBodyEnd())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('noscript')
    expect(els[0]!.props).toMatchObject({
      id: 'gtm-body-noscript',
      dangerouslySetInnerHTML: {
        __html: '<img src="https://www.googletagmanager.com/ns.html?id=GTM-XYZ" height="0" width="0" alt="">',
      },
    })
  })
})

// ---------------------------------------------------------------------------
// CSP nonce (Phase 1 reservation)
// ---------------------------------------------------------------------------

describe('CSP nonce reservation (Phase 1 no-op)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('inlineScript nonce: "auto" is accepted without warning and no nonce attr emitted', async () => {
    // Phase 1 reservation: the runtime accepts nonce: 'auto' on inlineScript
    // but does not propagate it to the rendered element.
    const plugin = definePlugin({
      name: 'csp-inline',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [
        {
          type: 'inlineScript',
          id: 'csp-snippet',
          body: "console.log('csp')",
          nonce: 'auto',
        },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('script')
    // nonce must NOT be present in the rendered element (Phase 1 no-op)
    expect(els[0]!.props).not.toHaveProperty('nonce')
    // No warnings should have been emitted
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('script (external src) nonce: "auto" is accepted without warning and no nonce attr emitted', async () => {
    // Phase 1 reservation: the runtime accepts nonce: 'auto' on the external
    // script variant but does not propagate it to the rendered element.
    const plugin = definePlugin({
      name: 'csp-external',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead'],
      publicHead: () => [
        {
          type: 'script',
          id: 'csp-loader',
          src: 'https://cdn.example.com/csp-test.js',
          nonce: 'auto',
        },
      ] satisfies PublicHeadDescriptor[],
    })
    const head = createPluginHead(makeConfig([plugin]), emptySettings)
    const els = childrenOf(await head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('script')
    // nonce must NOT be present in the rendered element (Phase 1 no-op)
    expect(els[0]!.props).not.toHaveProperty('nonce')
    // No warnings should have been emitted
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('"cspReady" capability declaration does not trigger a capability mismatch warning', () => {
    // 'cspReady' is a name-only reserved capability. Declaring it without any
    // paired implementation surface must not produce a mismatch warning.
    const plugin = definePlugin({
      name: 'csp-ready',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'cspReady'],
      publicHead: () => [],
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('cspReady'))).toBe(false)
  })

  it('"cspReady" capability + no nonce descriptor does not warn', () => {
    // Cross-check is not implemented in Phase 1: a plugin can declare
    // 'cspReady' without any descriptor carrying nonce: 'auto', or vice
    // versa — no runtime enforcement in either direction.
    const plugin = definePlugin({
      name: 'csp-ready-no-nonce',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicHead', 'cspReady'],
      publicHead: () => [
        {
          type: 'meta',
          name: 'test',
          content: 'value',
        },
      ] satisfies PublicHeadDescriptor[],
    })
    createPluginHead(makeConfig([plugin]), emptySettings)
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('cspReady'))).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
