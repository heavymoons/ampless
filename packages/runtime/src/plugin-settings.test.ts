import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPluginSettings } from './plugin-settings.js'
import type { StorageApi } from './storage.js'

function makeStorage(configured: boolean, url = 'https://example.com/public/site-settings.json'): StorageApi {
  return {
    isStorageConfigured: () => configured,
    publicAssetUrl: () => url,
  }
}

describe('createPluginSettings.loadAll', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns empty map when storage is unconfigured', async () => {
    const api = createPluginSettings(makeStorage(false))
    const snapshot = await api.loadAll()
    expect(snapshot.size).toBe(0)
  })

  it('returns empty map on fetch failure (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch
    const api = createPluginSettings(makeStorage(true))
    expect((await api.loadAll()).size).toBe(0)
  })

  it('returns empty map on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response) as unknown as typeof fetch
    const api = createPluginSettings(makeStorage(true))
    expect((await api.loadAll()).size).toBe(0)
  })

  it('returns empty map on JSON parse error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json')
      },
    } as unknown as Response) as unknown as typeof fetch
    const api = createPluginSettings(makeStorage(true))
    expect((await api.loadAll()).size).toBe(0)
  })

  it('groups flat plugins.<id>.<key> entries by instanceId', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'site.name': 'My Blog',
        'plugins.analytics-ga4.measurementId': 'G-ABC',
        'plugins.analytics-ga4.enabled': true,
        'plugins.webhook.endpoint': 'https://hooks.example.com',
        'theme.bg': '#fff',
      }),
    } as Response) as unknown as typeof fetch
    const api = createPluginSettings(makeStorage(true))
    const snapshot = await api.loadAll()
    expect(snapshot.size).toBe(2)
    expect(snapshot.get('analytics-ga4')).toEqual({
      measurementId: 'G-ABC',
      enabled: true,
    })
    expect(snapshot.get('webhook')).toEqual({
      endpoint: 'https://hooks.example.com',
    })
  })

  it('ignores entries that do not match plugins.<id>.<key>', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'plugins.lonely': 'no-key-suffix',
        'plugins': 'not-an-object',
        'unrelated.x': 1,
      }),
    } as Response) as unknown as typeof fetch
    const api = createPluginSettings(makeStorage(true))
    const snapshot = await api.loadAll()
    expect(snapshot.size).toBe(0)
  })

  it('returns empty map when publicAssetUrl throws', async () => {
    const storage: StorageApi = {
      isStorageConfigured: () => true,
      publicAssetUrl: () => {
        throw new Error('no bucket')
      },
    }
    const api = createPluginSettings(storage)
    expect((await api.loadAll()).size).toBe(0)
  })
})
