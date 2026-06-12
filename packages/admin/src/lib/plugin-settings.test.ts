import { describe, it, expect, beforeEach } from 'vitest'
import { setKvStore, type KvStore, type KvItem } from 'ampless'
import type { PluginSettingField } from 'ampless'
import {
  setPluginPublicSetting,
  deletePluginPublicSetting,
  getPluginPublicSetting,
  collectSettingWrites,
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

// `loadPluginPublicSettings` was removed from this client-side module.
// Server Components call `Admin.loadPluginPublicSettings(instanceId)`
// which goes through `ampless.pluginSettings.loadAll()` (S3 cache).
// The settings-snapshot grouping logic lives in
// `packages/runtime/src/plugin-settings.ts` and is covered by
// `packages/runtime/src/plugin-settings.test.ts`.

// ---------------------------------------------------------------------------
// getPluginPublicSetting
// ---------------------------------------------------------------------------

describe('getPluginPublicSetting', () => {
  it('returns null when no row exists', async () => {
    expect(await getPluginPublicSetting('ga4', 'measurementId')).toBeNull()
  })

  it('delegates to kv.get with the correct pk and sk', async () => {
    // Pre-populate via setPluginPublicSetting so the key composition matches
    await setPluginPublicSetting('ga4', measurementId, 'G-XYZ')
    const result = await getPluginPublicSetting('ga4', 'measurementId')
    expect(result).toBe('G-XYZ')
  })

  it('uses pluginSettingKey for sk composition', async () => {
    await setPluginPublicSetting('myplugin', enabled, true)
    // Confirm the sk that kv.get uses matches pluginSettingKey output
    const expectedSk = pluginSettingKey('myplugin', 'enabled')
    expect(expectedSk).toBe('plugins.myplugin.enabled')
    const result = await getPluginPublicSetting('myplugin', 'enabled')
    expect(result).toBe(true)
  })

  it('returns null after the row is deleted', async () => {
    await setPluginPublicSetting('ga4', measurementId, 'G-ABC')
    await deletePluginPublicSetting('ga4', measurementId)
    expect(await getPluginPublicSetting('ga4', 'measurementId')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// collectSettingWrites
// ---------------------------------------------------------------------------

// Minimal parse function matching the form's logic for these test fields:
//   text → return raw string (never null for non-empty)
//   boolean → 'true' → true, 'false' → false, else null
//   number → numeric string → number, '' → null, else null
function testParse(field: PluginSettingField, raw: string): unknown | null {
  switch (field.type) {
    case 'boolean':
      if (raw === 'true') return true
      if (raw === 'false') return false
      return null
    case 'number': {
      const trimmed = raw.trim()
      if (trimmed === '') return null
      const n = Number(trimmed)
      return Number.isNaN(n) ? null : n
    }
    default:
      return raw
  }
}

const textField: PluginSettingField = { type: 'text', key: 'title', label: 'Title' }
const boolField: PluginSettingField = { type: 'boolean', key: 'enabled', label: 'Enabled' }
const numField: PluginSettingField = { type: 'number', key: 'count', label: 'Count' }

describe('collectSettingWrites', () => {
  it('returns empty writes when no fields are touched', () => {
    const { writes, invalid } = collectSettingWrites(
      [textField, boolField],
      { title: 'hello', enabled: 'true' },
      {},
      testParse
    )
    expect(writes).toHaveLength(0)
    expect(invalid).toEqual({})
  })

  it('collects writes only for touched fields', () => {
    const { writes, invalid } = collectSettingWrites(
      [textField, boolField],
      { title: 'hello', enabled: 'true' },
      { title: true },
      testParse
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]?.field.key).toBe('title')
    expect(writes[0]?.parsed).toBe('hello')
    expect(invalid).toEqual({})
  })

  it('marks touched field as invalid when parse returns null for non-empty raw', () => {
    const { writes, invalid } = collectSettingWrites(
      [boolField],
      { enabled: 'notabool' },
      { enabled: true },
      testParse
    )
    expect(writes).toHaveLength(0)
    expect(invalid).toEqual({ enabled: true })
  })

  it('skips (not in writes, not invalid) when parse returns null for empty non-string field', () => {
    // number field with '' raw — parse returns null, raw is '' → skip path
    const { writes, invalid } = collectSettingWrites(
      [numField],
      { count: '' },
      { count: true },
      testParse
    )
    // Must be skipped — not a write (can't save empty number) and not invalid
    expect(writes).toHaveLength(0)
    expect(invalid).toEqual({})
  })

  it('collects multiple touched fields', () => {
    const { writes, invalid } = collectSettingWrites(
      [textField, boolField, numField],
      { title: 'hi', enabled: 'false', count: '5' },
      { title: true, enabled: true, count: true },
      testParse
    )
    expect(writes).toHaveLength(3)
    expect(writes.find((w) => w.field.key === 'title')?.parsed).toBe('hi')
    expect(writes.find((w) => w.field.key === 'enabled')?.parsed).toBe(false)
    expect(writes.find((w) => w.field.key === 'count')?.parsed).toBe(5)
    expect(invalid).toEqual({})
  })
})
