import { describe, it, expect } from 'vitest'
import type {
  PublicHeadDescriptor,
  PublicBodyDescriptor,
  PluginPublicRenderContext,
  AmplessPlugin,
} from 'ampless'
import { resolvePluginSettings } from 'ampless'
import gtmPlugin from './index.js'

const site: PluginPublicRenderContext['site'] = {
  name: 'Test',
  url: 'https://example.com/',
  description: 'A test',
}

// Mirror the runtime's per-request resolution: validate the manifest
// against the stored snapshot, then expose the result through a
// `ctx.setting()` closure. Both `publicHead` and `publicBodyEnd`
// share the same ctx so we can assert that the two surfaces stay in
// sync (admin saves `GTM-X` → both surfaces emit for `GTM-X`).
function makeCtx(
  plugin: AmplessPlugin,
  stored: Record<string, unknown> = {}
): PluginPublicRenderContext {
  const resolved = resolvePluginSettings(plugin.settings, stored)
  return {
    site,
    setting<T = unknown>(key: string): T | undefined {
      const v = resolved[key]
      return v === undefined ? undefined : (v as T)
    },
  }
}

function callPublicHead(
  plugin: AmplessPlugin,
  stored: Record<string, unknown> = {}
): readonly PublicHeadDescriptor[] {
  return plugin.publicHead?.(makeCtx(plugin, stored)) ?? []
}

function callPublicBodyEnd(
  plugin: AmplessPlugin,
  stored: Record<string, unknown> = {}
): readonly PublicBodyDescriptor[] {
  return plugin.publicBodyEnd?.(makeCtx(plugin, stored)) ?? []
}

describe('gtmPlugin (Phase 3a)', () => {
  it('emits loader + noscript descriptors for a valid container ID from default', () => {
    const plugin = gtmPlugin({ containerId: 'GTM-XYZ' })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(1)
    const [loader] = head as [PublicHeadDescriptor]
    expect(loader.type).toBe('inlineScript')
    if (loader.type === 'inlineScript') {
      expect(loader.id).toBe('gtm-loader-gtm')
      expect(loader.strategy).toBe('afterInteractive')
      // JSON-encoded container ID inside the literal — checking
      // the quoted form catches accidental concatenation regressions.
      expect(loader.body).toContain('"GTM-XYZ"')
    }

    const body = callPublicBodyEnd(plugin)
    expect(body).toHaveLength(1)
    const [noscript] = body as [PublicBodyDescriptor]
    expect(noscript.type).toBe('noscript')
    if (noscript.type === 'noscript') {
      expect(noscript.id).toBe('gtm-noscript-gtm')
      expect(noscript.html).toContain('id=GTM-XYZ')
      expect(noscript.html).toContain('googletagmanager.com/ns.html')
    }
  })

  it('returns empty arrays from both surfaces when no container ID is configured', () => {
    const plugin = gtmPlugin()
    expect(callPublicHead(plugin)).toEqual([])
    expect(callPublicBodyEnd(plugin)).toEqual([])
  })

  it('stored value overrides the constructor default', () => {
    // Critical Phase 2 flow: the operator ships with
    // gtmPlugin({ containerId: 'GTM-FROMCONFIG' }) in cms.config.ts
    // then changes the live value from /admin/plugins. The stored
    // value must win in both surfaces.
    const plugin = gtmPlugin({ containerId: 'GTM-FROMCONFIG' })
    const head = callPublicHead(plugin, { containerId: 'GTM-FROMADMIN' })
    const [loader] = head as [PublicHeadDescriptor]
    if (loader.type === 'inlineScript') {
      expect(loader.body).toContain('"GTM-FROMADMIN"')
      expect(loader.body).not.toContain('GTM-FROMCONFIG')
    }
    const body = callPublicBodyEnd(plugin, { containerId: 'GTM-FROMADMIN' })
    const [noscript] = body as [PublicBodyDescriptor]
    if (noscript.type === 'noscript') {
      expect(noscript.html).toContain('id=GTM-FROMADMIN')
    }
  })

  it('falls back to the constructor default when admin has not stored a value', () => {
    const plugin = gtmPlugin({ containerId: 'GTM-DEFAULT' })
    const head = callPublicHead(plugin)
    const [loader] = head as [PublicHeadDescriptor]
    if (loader.type === 'inlineScript') {
      expect(loader.body).toContain('"GTM-DEFAULT"')
    }
  })

  it('defaults instanceId to "gtm"', () => {
    const plugin = gtmPlugin({ containerId: 'GTM-AAA' })
    expect(plugin.instanceId).toBe('gtm')
  })

  it('honors an explicit instanceId in descriptor id suffixes', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-BBB',
      instanceId: 'marketing',
    })
    expect(plugin.instanceId).toBe('marketing')
    const [loader] = callPublicHead(plugin) as [PublicHeadDescriptor]
    const [noscript] = callPublicBodyEnd(plugin) as [PublicBodyDescriptor]
    if (loader.type === 'inlineScript') {
      expect(loader.id).toBe('gtm-loader-marketing')
    }
    if (noscript.type === 'noscript') {
      expect(noscript.id).toBe('gtm-noscript-marketing')
    }
  })

  it('declares publicHead, publicBody, and adminSettings capabilities', () => {
    const plugin = gtmPlugin({ containerId: 'GTM-XYZ' })
    expect(plugin.capabilities).toEqual(
      expect.arrayContaining(['publicHead', 'publicBody', 'adminSettings'])
    )
  })

  it('exposes a consentCategory text field in settings.public', () => {
    const plugin = gtmPlugin({ containerId: 'GTM-XYZ' })
    const fields = plugin.settings?.public ?? []
    const ccField = fields.find((f) => f.key === 'consentCategory')
    expect(ccField?.type).toBe('text')
  })
})

describe('gtmPlugin — gated mode (consentCategory set)', () => {
  it('publicHead returns a single inlineScript when consentCategory is set', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-GATED',
      consentCategory: 'analytics',
    })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(1)
    const [desc] = head as [PublicHeadDescriptor]
    expect(desc.type).toBe('inlineScript')
  })

  it('gated body contains consent guard primitives', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-GATED',
      consentCategory: 'analytics',
    })
    const [desc] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (desc.type !== 'inlineScript') return
    expect(desc.body).toContain('if (initialized) return')
    expect(desc.body).toContain('window.amplessConsent.has')
    expect(desc.body).toContain('window.amplessConsent.on')
    expect(desc.body).toContain('ampless:consent-ready')
    expect(desc.body).toContain('console.warn')
  })

  it('gated body embeds the consentCategory as a JSON literal', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-GATED',
      consentCategory: 'analytics',
    })
    const [desc] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (desc.type !== 'inlineScript') return
    expect(desc.body).toContain('"analytics"')
  })

  it('publicBodyEnd returns [] in gated mode (noscript fallback suppressed)', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-GATED',
      consentCategory: 'analytics',
    })
    expect(callPublicBodyEnd(plugin)).toEqual([])
  })

  it('returns non-gated descriptors when consentCategory is empty string', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-NOTGATED',
      consentCategory: '',
    })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(1)
    expect(head[0]!.type).toBe('inlineScript')
    if (head[0]!.type === 'inlineScript') {
      expect((head[0] as { type: 'inlineScript'; body: string }).body).toContain('"GTM-NOTGATED"')
    }
    const body = callPublicBodyEnd(plugin)
    expect(body).toHaveLength(1)
    expect(body[0]!.type).toBe('noscript')
  })

  it('stored consentCategory overrides the constructor default', () => {
    const plugin = gtmPlugin({
      containerId: 'GTM-GATED',
      consentCategory: '',
    })
    // Admin saves a non-empty consentCategory → switches to gated mode
    const head = callPublicHead(plugin, { consentCategory: 'marketing' })
    expect(head).toHaveLength(1)
    const [desc] = head as [PublicHeadDescriptor]
    expect(desc.type).toBe('inlineScript')
    if (desc.type === 'inlineScript') {
      expect(desc.body).toContain('"marketing"')
    }
    // noscript must also be suppressed
    expect(callPublicBodyEnd(plugin, { consentCategory: 'marketing' })).toEqual([])
  })
})
