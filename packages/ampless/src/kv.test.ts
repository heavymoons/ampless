import { describe, it, expect, beforeEach } from 'vitest'
import {
  setKvStore,
  hasKvStore,
  getSiteSetting,
  setSiteSetting,
  listSiteSettings,
  flattenSettings,
  unflattenSettings,
  SITE_CONFIG_PK,
  type KvStore,
} from './kv.js'

class MemoryKvStore implements KvStore {
  store = new Map<string, { value: unknown; ttl?: number }>()

  private kFor(pk: string, sk: string): string {
    return `${pk}//${sk}`
  }

  async get<T>(pk: string, sk: string): Promise<T | null> {
    const v = this.store.get(this.kFor(pk, sk))
    return v ? (v.value as T) : null
  }

  async query<T>(pk: string) {
    const out: Array<{ pk: string; sk: string; value: T; ttl?: number }> = []
    for (const [k, v] of this.store) {
      const [keyPk, sk] = k.split('//')
      if (keyPk === pk) out.push({ pk: keyPk, sk: sk!, value: v.value as T, ttl: v.ttl })
    }
    return out
  }

  async put(pk: string, sk: string, value: unknown, opts?: { ttlSeconds?: number }) {
    const ttl = opts?.ttlSeconds ? Math.floor(Date.now() / 1000) + opts.ttlSeconds : undefined
    this.store.set(this.kFor(pk, sk), { value, ttl })
  }

  async remove(pk: string, sk: string) {
    this.store.delete(this.kFor(pk, sk))
  }
}

describe('KvStore DI', () => {
  let mem: MemoryKvStore

  beforeEach(() => {
    mem = new MemoryKvStore()
    setKvStore(mem)
  })

  it('hasKvStore is true after setKvStore', () => {
    expect(hasKvStore()).toBe(true)
  })

  it('SITE_CONFIG_PK builds the right namespace', () => {
    expect(SITE_CONFIG_PK('default')).toBe('siteconfig:default')
    expect(SITE_CONFIG_PK('blog')).toBe('siteconfig:blog')
  })
})

describe('site settings helpers', () => {
  let mem: MemoryKvStore

  beforeEach(() => {
    mem = new MemoryKvStore()
    setKvStore(mem)
  })

  it('round-trips a single setting', async () => {
    await setSiteSetting('default', 'site.name', 'My Blog')
    expect(await getSiteSetting<string>('default', 'site.name')).toBe('My Blog')
  })

  it('returns null for an unset key', async () => {
    expect(await getSiteSetting('default', 'site.unknown')).toBeNull()
  })

  it('listSiteSettings returns the flat map for one site', async () => {
    await setSiteSetting('default', 'site.name', 'A')
    await setSiteSetting('default', 'site.url', 'https://a')
    await setSiteSetting('blog', 'site.name', 'B') // different site, must not leak
    const flat = await listSiteSettings('default')
    expect(flat).toEqual({ 'site.name': 'A', 'site.url': 'https://a' })
  })

  it('settings are persistent (no TTL set)', async () => {
    await setSiteSetting('default', 'site.name', 'forever')
    const stored = mem.store.get('siteconfig:default//site.name')
    expect(stored?.ttl).toBeUndefined()
  })
})

describe('flatten / unflatten', () => {
  it('flattens nested objects to dotted paths', () => {
    expect(
      flattenSettings({
        site: { name: 'My', url: 'https://my' },
        media: { imageDisplay: 'inline' },
      })
    ).toEqual({
      'site.name': 'My',
      'site.url': 'https://my',
      'media.imageDisplay': 'inline',
    })
  })

  it('keeps arrays as values, not flattened', () => {
    expect(flattenSettings({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] })
  })

  it('keeps null as a value', () => {
    expect(flattenSettings({ foo: null })).toEqual({ foo: null })
  })

  it('unflattens dotted paths back into nested', () => {
    expect(
      unflattenSettings({
        'site.name': 'My',
        'site.url': 'https://my',
        'media.imageDisplay': 'inline',
      })
    ).toEqual({
      site: { name: 'My', url: 'https://my' },
      media: { imageDisplay: 'inline' },
    })
  })

  it('round-trips flatten ↔ unflatten', () => {
    const original = {
      site: { name: 'A' },
      media: { processing: { quality: 0.85, format: 'webp' } },
      timezone: 'UTC',
    }
    expect(unflattenSettings(flattenSettings(original))).toEqual(original)
  })
})
