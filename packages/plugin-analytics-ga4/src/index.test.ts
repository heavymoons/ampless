import { describe, it, expect } from 'vitest'
import type {
  PublicHeadDescriptor,
  PluginPublicRenderContext,
  AmplessPlugin,
} from 'ampless'
import { resolvePluginSettings } from 'ampless'
import analyticsGa4Plugin from './index.js'

const site: PluginPublicRenderContext['site'] = {
  name: 'Test',
  url: 'https://example.com/',
  description: 'A test',
}

// Mirror what the runtime does: resolve the field manifest against a
// stored snapshot, build a ctx.setting() that closes over the result,
// then invoke publicHead. Keeps the tests honest about Phase 2 — the
// production rendering path goes through this exact same resolver.
function callPublicHead(
  plugin: AmplessPlugin,
  stored: Record<string, unknown> = {}
): readonly PublicHeadDescriptor[] {
  const resolved = resolvePluginSettings(plugin.settings, stored)
  const ctx: PluginPublicRenderContext = {
    site,
    setting<T = unknown>(key: string): T | undefined {
      const v = resolved[key]
      return v === undefined ? undefined : (v as T)
    },
  }
  return plugin.publicHead?.(ctx) ?? []
}

describe('analyticsGa4Plugin (Phase 2 settings)', () => {
  it('emits loader + init descriptors for a valid measurement ID from default', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-XXX' })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(2)
    const [loader, init] = head as [PublicHeadDescriptor, PublicHeadDescriptor]
    expect(loader.type).toBe('script')
    if (loader.type === 'script') {
      expect(loader.id).toBe('ga4-loader-analytics-ga4')
      expect(loader.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-XXX')
      expect(loader.strategy).toBe('afterInteractive')
    }
    expect(init.type).toBe('inlineScript')
    if (init.type === 'inlineScript') {
      expect(init.id).toBe('ga4-init-analytics-ga4')
      expect(init.body).toContain("gtag('config', \"G-XXX\")")
    }
  })

  it('returns an empty array when no measurement ID is configured', () => {
    const plugin = analyticsGa4Plugin()
    expect(callPublicHead(plugin)).toEqual([])
  })

  it('returns empty when default is set but admin saved empty string (disable)', () => {
    // Critical Phase 2 flow: site owner ships with cms.config
    // measurementId='G-DEFAULT', then disables analytics by saving
    // empty string from /admin/plugins. The stored '' must
    // *override* the manifest default — not fall back to it.
    const plugin = analyticsGa4Plugin({ measurementId: 'G-DEFAULT' })
    expect(callPublicHead(plugin, { measurementId: '' })).toEqual([])
  })

  it('stored value overrides the constructor default', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-OLD' })
    const head = callPublicHead(plugin, { measurementId: 'G-NEW' })
    const [loader] = head as [PublicHeadDescriptor]
    if (loader.type === 'script') {
      expect(loader.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-NEW')
    }
  })

  it('invalid stored value falls back to constructor default', () => {
    // Tampering / schema drift: stored value doesn't match the
    // pattern. We'd rather render the default than block the plugin
    // entirely.
    const plugin = analyticsGa4Plugin({ measurementId: 'G-FALLBACK' })
    const head = callPublicHead(plugin, { measurementId: 'not-a-ga4-id' })
    const [loader] = head as [PublicHeadDescriptor]
    if (loader.type === 'script') {
      expect(loader.src).toBe(
        'https://www.googletagmanager.com/gtag/js?id=G-FALLBACK'
      )
    }
  })

  it('defaults instanceId to "analytics-ga4"', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-AAA' })
    expect(plugin.instanceId).toBe('analytics-ga4')
  })

  it('honors an explicit instanceId in plugin id suffixes', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-BBB',
      instanceId: 'marketing',
    })
    expect(plugin.instanceId).toBe('marketing')
    const [loader, init] = callPublicHead(plugin) as [
      PublicHeadDescriptor,
      PublicHeadDescriptor,
    ]
    if (loader.type === 'script') expect(loader.id).toBe('ga4-loader-marketing')
    if (init.type === 'inlineScript') expect(init.id).toBe('ga4-init-marketing')
  })

  it('declares the adminSettings capability', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-XXX' })
    expect(plugin.capabilities).toEqual(
      expect.arrayContaining(['publicHead', 'adminSettings'])
    )
  })

  it('exposes a settings.public manifest with a measurementId field', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-XXX' })
    expect(plugin.settings?.public).toBeDefined()
    const fields = plugin.settings!.public!
    expect(fields).toHaveLength(1)
    expect(fields[0]!.key).toBe('measurementId')
    expect(fields[0]!.type).toBe('text')
  })
})
