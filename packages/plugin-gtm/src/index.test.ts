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
})
