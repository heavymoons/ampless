import { describe, it, expect } from 'vitest'
import type { PublicHeadDescriptor, PluginPublicRenderContext } from 'ampless'
import analyticsGa4Plugin from './index.js'

const site: PluginPublicRenderContext['site'] = {
  name: 'Test',
  url: 'https://example.com/',
  description: 'A test',
}
const ctx: PluginPublicRenderContext = { site }

function headOf(plugin: ReturnType<typeof analyticsGa4Plugin>): PublicHeadDescriptor[] {
  return [...(plugin.publicHead?.(ctx) ?? [])]
}

describe('analyticsGa4Plugin', () => {
  it('emits loader + init descriptors for a valid measurement ID', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-XXX' })
    const head = headOf(plugin)
    expect(head).toHaveLength(2)
    const [loader, init] = head as [PublicHeadDescriptor, PublicHeadDescriptor]
    // Loader
    expect(loader.type).toBe('script')
    if (loader.type === 'script') {
      expect(loader.id).toBe('ga4-loader-analytics-ga4')
      expect(loader.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-XXX')
      expect(loader.strategy).toBe('afterInteractive')
    }
    // Inline init
    expect(init.type).toBe('inlineScript')
    if (init.type === 'inlineScript') {
      expect(init.id).toBe('ga4-init-analytics-ga4')
      expect(init.strategy).toBe('afterInteractive')
      expect(init.body).toContain("gtag('config', \"G-XXX\")")
      expect(init.body).toContain('window.dataLayer = window.dataLayer || [];')
    }
  })

  it('returns an empty array when measurementId is blank', () => {
    const plugin = analyticsGa4Plugin({ measurementId: '' })
    expect(headOf(plugin)).toEqual([])
  })

  it('defaults instanceId to "analytics-ga4"', () => {
    const plugin = analyticsGa4Plugin({ measurementId: 'G-AAA' })
    expect(plugin.instanceId).toBe('analytics-ga4')
    const [loader, init] = headOf(plugin) as [PublicHeadDescriptor, PublicHeadDescriptor]
    if (loader.type === 'script') expect(loader.id).toBe('ga4-loader-analytics-ga4')
    if (init.type === 'inlineScript') expect(init.id).toBe('ga4-init-analytics-ga4')
  })

  it('honors an explicit instanceId in plugin id suffixes', () => {
    const plugin = analyticsGa4Plugin({
      measurementId: 'G-BBB',
      instanceId: 'marketing',
    })
    expect(plugin.instanceId).toBe('marketing')
    const [loader, init] = headOf(plugin) as [PublicHeadDescriptor, PublicHeadDescriptor]
    if (loader.type === 'script') expect(loader.id).toBe('ga4-loader-marketing')
    if (init.type === 'inlineScript') expect(init.id).toBe('ga4-init-marketing')
  })
})
