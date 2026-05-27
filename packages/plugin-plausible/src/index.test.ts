import { describe, it, expect } from 'vitest'
import type {
  PublicHeadDescriptor,
  PluginPublicRenderContext,
  AmplessPlugin,
} from 'ampless'
import { resolvePluginSettings } from 'ampless'
import plausiblePlugin from './index.js'

const site: PluginPublicRenderContext['site'] = {
  name: 'Test',
  url: 'https://example.com/',
  description: 'A test',
}

const DEFAULT_SCRIPT_URL = 'https://plausible.io/js/script.js'

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

describe('plausiblePlugin (Phase 3a)', () => {
  it('emits a single script descriptor for a valid domain from default', () => {
    const plugin = plausiblePlugin({ domain: 'example.com' })
    const head = callPublicHead(plugin)
    expect(head).toHaveLength(1)
    const [script] = head as [PublicHeadDescriptor]
    expect(script.type).toBe('script')
    if (script.type === 'script') {
      expect(script.id).toBe('plausible-plausible')
      expect(script.src).toBe(DEFAULT_SCRIPT_URL)
      expect(script.strategy).toBe('lazyOnload')
      expect(script.defer).toBe(true)
      expect(script.attrs).toEqual({ 'data-domain': 'example.com' })
    }
  })

  it('returns an empty array when no domain is configured', () => {
    const plugin = plausiblePlugin()
    expect(callPublicHead(plugin)).toEqual([])
  })

  it('stored domain overrides the constructor default', () => {
    const plugin = plausiblePlugin({ domain: 'old.example.com' })
    const head = callPublicHead(plugin, { domain: 'new.example.com' })
    const [script] = head as [PublicHeadDescriptor]
    if (script.type === 'script') {
      expect(script.attrs).toEqual({ 'data-domain': 'new.example.com' })
    }
  })

  it('falls back to the constructor default when admin has not stored a domain', () => {
    const plugin = plausiblePlugin({ domain: 'fallback.example.com' })
    const head = callPublicHead(plugin)
    const [script] = head as [PublicHeadDescriptor]
    if (script.type === 'script') {
      expect(script.attrs).toEqual({ 'data-domain': 'fallback.example.com' })
    }
  })

  it('uses the hosted plausible.io URL by default', () => {
    const plugin = plausiblePlugin({ domain: 'example.com' })
    const [script] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (script.type === 'script') {
      expect(script.src).toBe(DEFAULT_SCRIPT_URL)
    }
  })

  it('admin can override scriptUrl for self-hosted Plausible', () => {
    const plugin = plausiblePlugin({ domain: 'example.com' })
    const head = callPublicHead(plugin, {
      scriptUrl: 'https://analytics.example.com/js/script.js',
    })
    const [script] = head as [PublicHeadDescriptor]
    if (script.type === 'script') {
      expect(script.src).toBe('https://analytics.example.com/js/script.js')
    }
  })

  it('returns empty when an invalid scriptUrl constructor default is rejected by the resolver', () => {
    // Dogfoods the Phase 2 default-validation behaviour in
    // resolvePluginSettings: a malformed constructor `scriptUrl`
    // fails `validatePluginSettingValue` for the `url` field, so
    // ctx.setting('scriptUrl') is undefined and the whole plugin
    // emits nothing. Without that guard, a bad value at install
    // time would surface as a broken <script src="not a url"> tag.
    const plugin = plausiblePlugin({
      domain: 'example.com',
      scriptUrl: 'not a url',
    })
    expect(callPublicHead(plugin)).toEqual([])
  })

  it('defaults instanceId to "plausible"', () => {
    const plugin = plausiblePlugin({ domain: 'example.com' })
    expect(plugin.instanceId).toBe('plausible')
  })

  it('honors an explicit instanceId in the script id suffix', () => {
    const plugin = plausiblePlugin({
      domain: 'example.com',
      instanceId: 'marketing',
    })
    expect(plugin.instanceId).toBe('marketing')
    const [script] = callPublicHead(plugin) as [PublicHeadDescriptor]
    if (script.type === 'script') {
      expect(script.id).toBe('plausible-marketing')
    }
  })

  it('declares publicHead and adminSettings capabilities', () => {
    const plugin = plausiblePlugin({ domain: 'example.com' })
    expect(plugin.capabilities).toEqual(
      expect.arrayContaining(['publicHead', 'adminSettings'])
    )
  })

  it('declares scriptUrl as a required URL field', () => {
    const plugin = plausiblePlugin({ domain: 'example.com' })
    const fields = plugin.settings?.public ?? []
    const scriptUrlField = fields.find((f) => f.key === 'scriptUrl')
    expect(scriptUrlField?.type).toBe('url')
    expect(scriptUrlField?.required).toBe(true)
  })
})
