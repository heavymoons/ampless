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
    expect(fields).toHaveLength(2)
    expect(fields[0]!.key).toBe('measurementId')
    expect(fields[0]!.type).toBe('text')
    expect(fields[1]!.key).toBe('consentCategory')
    expect(fields[1]!.type).toBe('text')
  })
})

describe('analyticsGa4Plugin — gated mode (consentCategory set)', () => {
  it('returns a single inlineScript when consentCategory is set', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-GATED',
      consentCategory: 'analytics',
    })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(1)
    const [desc] = head as [PublicHeadDescriptor]
    expect(desc.type).toBe('inlineScript')
  })

  it('gated body contains consent guard primitives', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-GATED',
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

  it('gated body embeds the loader src identical to non-gated external descriptor', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-GATED',
      consentCategory: 'analytics',
    })
    const [desc] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (desc.type !== 'inlineScript') return
    // The loader src must match what the non-gated external descriptor would use
    expect(desc.body).toContain(
      'https://www.googletagmanager.com/gtag/js?id=G-GATED'
    )
  })

  it('gated body embeds the consentCategory as a JSON literal', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-GATED',
      consentCategory: 'analytics',
    })
    const [desc] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (desc.type !== 'inlineScript') return
    expect(desc.body).toContain('"analytics"')
  })

  // Regression: the standard non-gated GA snippet declares `function gtag()`
  // at top level so it hoists to global, leaving `window.gtag` callable
  // from later page code (custom events, etc). Inside our IIFE, a function
  // declaration is local — so the gated body must explicitly assign to
  // `window.gtag` to keep parity with the non-gated behavior.
  it('gated body binds gtag and dataLayer to window so window.gtag survives the IIFE', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-GATED',
      consentCategory: 'analytics',
    })
    const [desc] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (desc.type !== 'inlineScript') return
    expect(desc.body).toContain('window.dataLayer = window.dataLayer || []')
    expect(desc.body).toContain('window.gtag = window.gtag ||')
    expect(desc.body).toContain("window.gtag('js'")
    expect(desc.body).toContain("window.gtag('config'")
    // Guard against the regression: the IIFE-local `function gtag()` form
    // must not be how we ship gated mode anymore.
    expect(desc.body).not.toMatch(/function gtag\(\)\{dataLayer\.push/)
  })

  it('returns non-gated descriptors when consentCategory is empty string', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-NOTGATED',
      consentCategory: '',
    })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(2)
    expect(head[0]!.type).toBe('script')
    expect(head[1]!.type).toBe('inlineScript')
  })

  it('stored consentCategory overrides the constructor default', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-GATED',
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
  })
})
