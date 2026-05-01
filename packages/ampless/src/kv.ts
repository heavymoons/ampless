// Generic key/value store interface, used as both:
//  - the persistence layer for site settings (`siteconfig:{siteId}` PK)
//  - a TTL-backed cache for plugins / internal Lambdas (`cache:{ns}` PK)
//
// Items with `ttlSeconds` set are deleted automatically by DynamoDB's
// TTL feature. Items written without a TTL are persisted forever and
// read as configuration. The PK prefix is the only thing that
// separates namespaces; callers pick a convention.
//
// The runtime injects a concrete implementation via `setKvStore()` —
// the templates/blog Next.js side wires an AppSync-backed implementation,
// processor Lambdas wire a DynamoDB-direct one. Without an injected
// store, calls throw — there is no in-memory fallback.

import { DEFAULT_SITE_ID } from './sites.js'

export interface KvItem<T = unknown> {
  pk: string
  sk: string
  value: T
  /** Unix epoch seconds. Absent → persistent. */
  ttl?: number
}

export interface KvStore {
  get<T = unknown>(pk: string, sk: string): Promise<T | null>
  query<T = unknown>(pk: string): Promise<KvItem<T>[]>
  put(pk: string, sk: string, value: unknown, opts?: { ttlSeconds?: number }): Promise<void>
  remove(pk: string, sk: string): Promise<void>
}

let store: KvStore | null = null

export function setKvStore(s: KvStore): void {
  store = s
}

export function hasKvStore(): boolean {
  return store !== null
}

function requireStore(): KvStore {
  if (!store) {
    throw new Error('No KvStore configured. Call setKvStore() during initialization.')
  }
  return store
}

// --- Site settings high-level helpers ---
//
// Settings are stored under PK = `siteconfig:{siteId}`, SK = the dotted
// key (`site.name`, `media.imageDisplay`, ...). Persistent (no TTL).

export const SITE_CONFIG_PK = (siteId: string): string => `siteconfig:${siteId}`

export async function getSiteSetting<T = unknown>(
  siteId: string,
  key: string
): Promise<T | null> {
  return requireStore().get<T>(SITE_CONFIG_PK(siteId), key)
}

export async function setSiteSetting(
  siteId: string,
  key: string,
  value: unknown
): Promise<void> {
  return requireStore().put(SITE_CONFIG_PK(siteId), key, value)
}

export async function deleteSiteSetting(siteId: string, key: string): Promise<void> {
  return requireStore().remove(SITE_CONFIG_PK(siteId), key)
}

/**
 * Fetch every setting for a site as a flat map (`{ 'site.name': 'My Blog', ... }`).
 * Use `unflattenSettings` to convert to the nested shape if needed.
 */
export async function listSiteSettings(
  siteId: string = DEFAULT_SITE_ID
): Promise<Record<string, unknown>> {
  const items = await requireStore().query(SITE_CONFIG_PK(siteId))
  const out: Record<string, unknown> = {}
  for (const item of items) {
    out[item.sk] = item.value
  }
  return out
}

// --- Settings shape conversions ---
//
// Storage is flat (`'site.name'`), but consumers want nested
// (`{ site: { name } }`). `flatten` and `unflatten` mediate.

export function flattenSettings(
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenSettings(v as Record<string, unknown>, path))
    } else {
      out[path] = v
    }
  }
  return out
}

export function unflattenSettings(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let cursor = out
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      const existing = cursor[part]
      if (existing === undefined || typeof existing !== 'object' || existing === null) {
        cursor[part] = {}
      }
      cursor = cursor[part] as Record<string, unknown>
    }
    cursor[parts[parts.length - 1]!] = value
  }
  return out
}
