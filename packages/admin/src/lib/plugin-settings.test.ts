import { describe, it, expect, beforeEach } from 'vitest'
import { setKvStore, type KvStore, type KvItem } from 'ampless'
import type { PluginSettingField } from 'ampless'
import {
  loadPluginPublicSettings,
  setPluginPublicSetting,
  deletePluginPublicSetting,
  pluginSettingKey,
} from './plugin-settings.js'

interface Row {
  pk: string
  sk: string
  value: unknown
}

function makeInMemoryKv(): { store: KvStore; rows: Map<string, Row> } {
  const rows = new Map<string, Row>()
  const key = (pk: string, sk: string) => `${pk}::${sk}`
  const store: KvStore = {
    async get<T = unknown>(pk: string, sk: string): Promise<T | null> {
      const row = rows.get(key(pk, sk))
      return (row?.value as T) ?? null
    },
    async query<T = unknown>(pk: string): Promise<KvItem<T>[]> {
      const out: KvItem<T>[] = []
      for (const row of rows.values()) {
        if (row.pk === pk) {
          out.push({ pk: row.pk, sk: row.sk, value: row.value as T })
        }
      }
      return out
    },
    async put(pk, sk, value) {
      rows.set(key(pk, sk), { pk, sk, value })
    },
    async remove(pk, sk) {
      rows.delete(key(pk, sk))
    },
  }
  return { store, rows }
}

const measurementId: PluginSettingField = {
  type: 'text',
  key: 'measurementId',
  label: 'mid',
  pattern: '^$|^G-[A-Z0-9]+$',
}

const enabled: PluginSettingField = {
  type: 'boolean',
  key: 'enabled',
  label: 'enabled',
}

let kv: ReturnType<typeof makeInMemoryKv>

beforeEach(() => {
  kv = makeInMemoryKv()
  setKvStore(kv.store)
})

describe('pluginSettingKey', () => {
  it('builds the storage SK pattern', () => {
    expect(pluginSettingKey('analytics-ga4', 'measurementId')).toBe(
      'plugins.analytics-ga4.measurementId'
    )
  })
})

describe('setPluginPublicSetting', () => {
  it('writes a validated text value into siteconfig partition', async () => {
    await setPluginPublicSetting('ga4', measurementId, 'G-ABC')
    expect(kv.rows.size).toBe(1)
    const row = [...kv.rows.values()][0]!
    expect(row).toMatchObject({
      pk: 'siteconfig',
      sk: 'plugins.ga4.measurementId',
      value: 'G-ABC',
    })
  })

  it('writes empty string as an explicit disable value', async () => {
    await setPluginPublicSetting('ga4', measurementId, '')
    const row = [...kv.rows.values()][0]!
    expect(row.value).toBe('')
  })

  it('throws on pattern-violating value (no write)', async () => {
    await expect(setPluginPublicSetting('ga4', measurementId, 'bad')).rejects.toThrow(/Invalid value/)
    expect(kv.rows.size).toBe(0)
  })

  it('throws when instanceId is invalid', async () => {
    await expect(setPluginPublicSetting('bad.id', measurementId, 'G-X')).rejects.toThrow(/Invalid plugin instanceId/)
  })

  it('throws when field key is invalid', async () => {
    await expect(
      setPluginPublicSetting('ga4', { ...measurementId, key: 'bad.key' }, 'G-X')
    ).rejects.toThrow(/Invalid plugin field key/)
  })

  it('persists boolean true/false losslessly', async () => {
    await setPluginPublicSetting('ga4', enabled, true)
    const row = [...kv.rows.values()][0]!
    expect(row.value).toBe(true)
  })
})

describe('deletePluginPublicSetting', () => {
  it('removes the row', async () => {
    await setPluginPublicSetting('ga4', measurementId, 'G-X')
    expect(kv.rows.size).toBe(1)
    await deletePluginPublicSetting('ga4', measurementId)
    expect(kv.rows.size).toBe(0)
  })
})

describe('loadPluginPublicSettings', () => {
  it('returns rows scoped to one instance, keyed by field key', async () => {
    await kv.store.put('siteconfig', 'plugins.ga4.measurementId', 'G-AAA')
    await kv.store.put('siteconfig', 'plugins.ga4.enabled', true)
    await kv.store.put('siteconfig', 'plugins.webhook.endpoint', 'https://x')
    await kv.store.put('siteconfig', 'site.name', 'My Blog')
    const result = await loadPluginPublicSettings('ga4')
    expect(result).toEqual({ measurementId: 'G-AAA', enabled: true })
  })

  it('returns empty object for an unknown instance', async () => {
    expect(await loadPluginPublicSettings('nobody')).toEqual({})
  })

  it('returns empty object for an invalid instanceId (no DDB query)', async () => {
    expect(await loadPluginPublicSettings('bad.id')).toEqual({})
  })
})
