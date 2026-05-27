import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isValidElement, Fragment, type ReactElement } from 'react'
import { definePlugin, type Config, type PublicHeadDescriptor } from 'ampless'
import { createPluginHead } from './plugin-head.js'

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

  it('returns null when no plugins are registered', () => {
    const head = createPluginHead(makeConfig([]))
    expect(head.renderHead()).toBeNull()
    expect(head.renderBodyEnd()).toBeNull()
  })

  it('renders both a script and an inline script for a single plugin', () => {
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
    const head = createPluginHead(makeConfig([plugin]))
    const els = childrenOf(head.renderHead())
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

  it('drops a script descriptor with a javascript: scheme and warns', () => {
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
    const head = createPluginHead(makeConfig([plugin]))
    const els = childrenOf(head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.props).toMatchObject({ src: 'https://cdn.example.com/ok.js' })
    expect(warnSpy).toHaveBeenCalled()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('unsafe src "javascript:alert(1)"'))).toBe(true)
  })

  it('drops an inlineScript missing its id and warns', () => {
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
    const head = createPluginHead(makeConfig([plugin]))
    expect(head.renderHead()).toBeNull()
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('missing required "id"'))).toBe(true)
  })

  it('keeps the last descriptor when two share the same id and warns', () => {
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
    const head = createPluginHead(makeConfig([plugin]))
    const els = childrenOf(head.renderHead())
    expect(els).toHaveLength(1)
    expect((els[0]!.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML.__html).toBe(
      '/* second */'
    )
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('duplicate descriptor id "shared"'))).toBe(true)
  })

  it('preserves cms.config.plugins order across multiple plugins', () => {
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
    const head = createPluginHead(makeConfig([a, b]))
    const els = childrenOf(head.renderHead())
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
    createPluginHead(makeConfig([p1, p2]))
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
    createPluginHead(makeConfig([plugin]))
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
    createPluginHead(makeConfig([plugin]))
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
    createPluginHead(makeConfig([plugin]))
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      messages.some((m: string) => m.includes('not in declared capabilities'))
    ).toBe(false)
  })

  it('drops `nonce` from attrs (Phase 1 scopes nonce out, CSP RFP owns it)', () => {
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
    const head = createPluginHead(makeConfig([plugin]))
    const els = childrenOf(head.renderHead())
    expect(els).toHaveLength(1)
    expect(els[0]!.props).toMatchObject({ crossorigin: 'anonymous' })
    expect(els[0]!.props).not.toHaveProperty('nonce')
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m: string) => m.includes('attr "nonce" not in allowlist'))).toBe(true)
  })

  it('renders body-end iframe descriptors with allow-listed attrs', () => {
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
    const head = createPluginHead(makeConfig([plugin]))
    const els = childrenOf(head.renderBodyEnd())
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe('iframe')
    expect(els[0]!.props).toMatchObject({
      src: 'https://www.googletagmanager.com/ns.html?id=GTM-XYZ',
      sandbox: 'allow-scripts',
      'data-tracking': 'gtm',
    })
  })
})
