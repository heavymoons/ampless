import { describe, it, expect } from 'vitest'
import type {
  PublicHeadDescriptor,
  PublicBodyDescriptor,
  PluginPublicRenderContext,
  AmplessPlugin,
} from 'ampless'
import { resolvePluginSettings } from 'ampless'
import cookieConsentPlugin from './index.js'
import packageJson from '../package.json' with { type: 'json' }

const site: PluginPublicRenderContext['site'] = {
  name: 'Test Site',
  url: 'https://example.com/',
  description: 'A test site',
}

// Mirror what the runtime does: resolve field manifest against stored settings,
// build ctx.setting() that closes over the result, then invoke the surface method.
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

function callPublicBodyEnd(
  plugin: AmplessPlugin,
  stored: Record<string, unknown> = {}
): readonly PublicBodyDescriptor[] {
  const resolved = resolvePluginSettings(plugin.settings, stored)
  const ctx: PluginPublicRenderContext = {
    site,
    setting<T = unknown>(key: string): T | undefined {
      const v = resolved[key]
      return v === undefined ? undefined : (v as T)
    },
  }
  return plugin.publicBodyEnd?.(ctx) ?? []
}

const analyticsCategory = {
  id: 'analytics',
  label: 'Analytics',
  description: 'Help us understand how visitors use the site.',
  defaultEnabled: false,
  essential: false,
}

const essentialCategory = {
  id: 'functional',
  label: 'Functional',
  description: 'Required for the site to work correctly.',
  defaultEnabled: true,
  essential: true,
}

describe('cookieConsentPlugin — plugin shape', () => {
  it('returns a plugin with the correct name and packageName', () => {
    const plugin = cookieConsentPlugin()
    expect(plugin.name).toBe('cookie-consent')
    expect(plugin.packageName).toBe('@ampless/plugin-cookie-consent')
  })

  it('defaults instanceId to "cookie-consent"', () => {
    const plugin = cookieConsentPlugin()
    expect(plugin.instanceId).toBe('cookie-consent')
  })

  it('honors an explicit instanceId', () => {
    const plugin = cookieConsentPlugin({ instanceId: 'gdpr' })
    expect(plugin.instanceId).toBe('gdpr')
  })

  it('declares the expected capabilities', () => {
    const plugin = cookieConsentPlugin()
    expect(plugin.capabilities).toEqual(
      expect.arrayContaining(['publicHead', 'publicBody', 'adminSettings'])
    )
  })

  it('declares trust_level untrusted', () => {
    const plugin = cookieConsentPlugin()
    expect(plugin.trust_level).toBe('untrusted')
  })

  it('declares apiVersion 1', () => {
    const plugin = cookieConsentPlugin()
    expect(plugin.apiVersion).toBe(1)
  })

  it('package.json amplessPlugin.capabilities matches factory capabilities', () => {
    const plugin = cookieConsentPlugin()
    // Static manifest cross-check: capabilities in package.json must match
    // the capabilities the factory declares (order-independent).
    const staticCaps = new Set(packageJson.amplessPlugin.capabilities)
    const runtimeCaps = new Set(plugin.capabilities ?? [])
    expect(staticCaps).toEqual(runtimeCaps)
  })
})

describe('cookieConsentPlugin — settings manifest', () => {
  it('exposes settings.public with the expected fields', () => {
    const plugin = cookieConsentPlugin()
    expect(plugin.settings?.public).toBeDefined()
    const fields = plugin.settings!.public!
    const keys = fields.map((f) => f.key)
    expect(keys).toContain('bannerText')
    expect(keys).toContain('acceptLabel')
    expect(keys).toContain('rejectLabel')
    expect(keys).toContain('position')
    expect(keys).toContain('categories')
  })

  it('categories field is type repeatable', () => {
    const plugin = cookieConsentPlugin()
    const catField = plugin.settings!.public!.find((f) => f.key === 'categories')
    expect(catField?.type).toBe('repeatable')
  })
})

describe('cookieConsentPlugin — publicHead', () => {
  it('returns exactly one descriptor', () => {
    const plugin = cookieConsentPlugin()
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(1)
  })

  it('descriptor is type inlineScript with strategy afterInteractive', () => {
    // Note: ampless ScriptStrategy does not include 'beforeInteractive'.
    // The install script runs afterInteractive; analytics plugins also run
    // afterInteractive, so ordering depends on plugin registration order in
    // cms.config.ts (cookie-consent should be listed first).
    const plugin = cookieConsentPlugin()
    const [d] = callPublicHead(plugin) as [PublicHeadDescriptor]
    expect(d.type).toBe('inlineScript')
    if (d.type === 'inlineScript') {
      expect(d.id).toBe('cookie-consent-install-cookie-consent')
      expect(d.strategy).toBe('afterInteractive')
    }
  })

  it('install script body contains window.amplessConsent API', () => {
    const plugin = cookieConsentPlugin()
    const [d] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (d.type === 'inlineScript') {
      expect(d.body).toContain('window.amplessConsent')
      expect(d.body).toContain("STORAGE_KEY = 'ampless:consent'")
      expect(d.body).toContain('ampless:consent-ready')
      expect(d.body).toContain('has:')
      expect(d.body).toContain('on:')
      expect(d.body).toContain('set:')
    }
  })

  it('install script embeds categories JSON from ctx.setting', () => {
    const plugin = cookieConsentPlugin()
    const stored = { categories: [analyticsCategory] }
    const [d] = callPublicHead(plugin, stored) as [PublicHeadDescriptor]
    if (d.type === 'inlineScript') {
      expect(d.body).toContain('"analytics"')
      expect(d.body).toContain('"Analytics"')
    }
  })

  it('install script embeds empty array when categories not set', () => {
    const plugin = cookieConsentPlugin()
    const [d] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (d.type === 'inlineScript') {
      expect(d.body).toContain('categoriesConfig = []')
    }
  })

  it('instanceId suffix is reflected in the descriptor id', () => {
    const plugin = cookieConsentPlugin({ instanceId: 'gdpr' })
    const [d] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (d.type === 'inlineScript') {
      expect(d.id).toBe('cookie-consent-install-gdpr')
    }
  })
})

describe('cookieConsentPlugin — publicBodyEnd', () => {
  it('returns empty array when categories is empty', () => {
    const plugin = cookieConsentPlugin()
    const body = callPublicBodyEnd(plugin)
    expect(body).toEqual([])
  })

  it('returns empty array when categories is not provided (default)', () => {
    const plugin = cookieConsentPlugin()
    // resolvePluginSettings returns default [] for repeatable fields
    const body = callPublicBodyEnd(plugin, {})
    expect(body).toEqual([])
  })

  it('returns one descriptor when categories are configured', () => {
    const plugin = cookieConsentPlugin()
    const stored = { categories: [analyticsCategory] }
    const body = callPublicBodyEnd(plugin, stored)
    expect(body).toHaveLength(1)
  })

  it('descriptor is type inlineScript with strategy afterInteractive', () => {
    const plugin = cookieConsentPlugin()
    const stored = { categories: [analyticsCategory] }
    const [d] = callPublicBodyEnd(plugin, stored) as [PublicBodyDescriptor]
    expect(d.type).toBe('inlineScript')
    if (d.type === 'inlineScript') {
      expect(d.id).toBe('cookie-consent-banner-cookie-consent')
      expect(d.strategy).toBe('afterInteractive')
    }
  })

  it('banner script body contains core DOM-append and consent API calls', () => {
    const plugin = cookieConsentPlugin()
    const stored = { categories: [analyticsCategory] }
    const [d] = callPublicBodyEnd(plugin, stored) as [PublicBodyDescriptor]
    if (d.type === 'inlineScript') {
      expect(d.body).toContain('document.body.appendChild')
      expect(d.body).toContain('window.amplessConsent.set')
    }
  })

  it('banner script reflects acceptLabel / rejectLabel / bannerText settings', () => {
    const plugin = cookieConsentPlugin()
    const stored = {
      categories: [analyticsCategory],
      acceptLabel: 'Yes please',
      rejectLabel: 'No thanks',
      bannerText: 'We use cookies for analytics.',
    }
    const [d] = callPublicBodyEnd(plugin, stored) as [PublicBodyDescriptor]
    if (d.type === 'inlineScript') {
      expect(d.body).toContain('Yes please')
      expect(d.body).toContain('No thanks')
      expect(d.body).toContain('We use cookies for analytics.')
    }
  })

  it('essential-only categories still return one banner descriptor (non-essential is empty, but banner may differ — returns empty)', () => {
    // When ALL categories are essential there are no non-essential categories,
    // so the banner returns [] (nothing to consent to for non-essential).
    const plugin = cookieConsentPlugin()
    const stored = { categories: [essentialCategory] }
    const body = callPublicBodyEnd(plugin, stored)
    // nonEssential.length === 0 → script body returns early → no banner
    expect(body).toHaveLength(1) // descriptor still emitted (check includes guard)
    const [d] = body as [PublicBodyDescriptor]
    if (d.type === 'inlineScript') {
      // nonEssential will be [] so the script returns early
      expect(d.body).toContain('nonEssential.length === 0')
    }
  })
})
