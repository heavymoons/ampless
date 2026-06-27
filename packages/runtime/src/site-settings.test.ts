import { describe, it, expect, afterEach, vi } from 'vitest'
import { createSiteSettings } from './site-settings.js'
import type { StorageApi } from './storage.js'

function makeStorage(
  configured: boolean,
  url = 'https://example.com/public/site-settings.json'
): StorageApi {
  return {
    isStorageConfigured: () => configured,
    publicAssetUrl: () => url,
  }
}

describe('createSiteSettings — type coercion', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('coerces numeric site.name / site.url / site.description to strings', async () => {
    // Simulate the KvStore round-trip bug: a number stored as a site setting
    // survives unflattenSettings as-is (e.g. 1470 for every field).
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'site.name': 1470,
        'site.url': 1470,
        'site.description': 1470,
      }),
    } as unknown as Response) as unknown as typeof fetch

    const api = createSiteSettings(
      {
        site: {
          name: 'Fallback Name',
          url: 'https://fallback.example.com',
          description: 'Fallback description',
        },
      },
      makeStorage(true)
    )

    const result = await api.loadSiteSettings()

    expect(typeof result.site.name).toBe('string')
    expect(result.site.name).toBe('1470')

    expect(typeof result.site.url).toBe('string')
    expect(result.site.url).toBe('1470')

    expect(typeof result.site.description).toBe('string')
    expect(result.site.description).toBe('1470')
  })

  it('falls back to base config values (as strings) when remote fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch

    const api = createSiteSettings(
      {
        site: {
          name: 'My Site',
          url: 'https://example.com',
        },
      },
      makeStorage(true)
    )

    const result = await api.loadSiteSettings()

    expect(typeof result.site.name).toBe('string')
    expect(result.site.name).toBe('My Site')
    expect(typeof result.site.url).toBe('string')
    expect(result.site.url).toBe('https://example.com')
    expect(result.site.description).toBeUndefined()
  })

  it('description is undefined when absent from both remote and base config', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 'site.name': 'Remote Name', 'site.url': 'https://remote.example.com' }),
    } as unknown as Response) as unknown as typeof fetch

    const api = createSiteSettings(
      {
        site: {
          name: 'Base Name',
          url: 'https://base.example.com',
        },
      },
      makeStorage(true)
    )

    const result = await api.loadSiteSettings()

    expect(result.site.description).toBeUndefined()
  })
})
