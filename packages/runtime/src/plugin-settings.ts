// Runtime helper that pulls admin-managed `settings.public` values
// out of the `public/site-settings.json` cache. Mirrors
// `createSiteSettings()` ([site-settings.ts](./site-settings.ts)) so
// the two share the same Next.js fetch dedup / tag invalidation
// pipeline — admin saves go DDB → trusted processor → S3, then this
// helper reads them at SSR time.
//
// We do NOT extend `EffectiveSiteSettings` to carry plugin namespaces.
// That type is the curated runtime config (site / media /
// dateFormat / timezone); mixing arbitrary plugin keys would blur the
// boundary. Plugin reads go through this separate API instead.

import { unflattenSettings } from 'ampless'
import type { StorageApi } from './storage.js'

/**
 * Per-instance flat map of stored field values, keyed by the field's
 * `key` (not the full `plugins.<instanceId>.<key>` SK). The keys
 * here mirror the field manifest so callers can hand the map
 * directly to `resolvePluginSettings`.
 */
export type PluginSettingsSnapshot = Map<string, Record<string, unknown>>

export interface PluginSettingsApi {
  /**
   * Fetch all `plugins.*` settings from the public cache and bucket
   * them by `instanceId`. Returns an empty Map on any failure mode
   * (storage unconfigured, 404, JSON parse error) — callers fall
   * back to manifest defaults so the layout never crashes when the
   * cache is missing.
   */
  loadAll(): Promise<PluginSettingsSnapshot>
}

export function createPluginSettings(storage: StorageApi): PluginSettingsApi {
  return {
    async loadAll(): Promise<PluginSettingsSnapshot> {
      const out: PluginSettingsSnapshot = new Map()

      // Storage unconfigured (initial sandbox, no deploy yet) → no
      // way to fetch anything. Return an empty snapshot; downstream
      // `resolvePluginSettings` covers everything via defaults.
      if (!storage.isStorageConfigured()) return out

      let url: string
      try {
        url = storage.publicAssetUrl('public/site-settings.json')
      } catch {
        return out
      }

      let flat: Record<string, unknown>
      try {
        const res = await fetch(url, {
          // Same revalidate + tag as site-settings.ts so a single
          // request to the public route hits the JSON once and both
          // helpers share the cached body.
          next: { revalidate: 60, tags: ['site-settings'] },
        })
        if (!res.ok) return out
        flat = (await res.json()) as Record<string, unknown>
      } catch {
        return out
      }

      // The trusted processor stores everything flat (`plugins.foo.bar = 'v'`).
      // We could also use `unflattenSettings` and look at `plugins.foo.bar`
      // through the nested shape, but iterating flat is simpler and
      // matches how site-settings.ts handles its own surface.
      //
      // We still run unflatten on each `plugins.<id>` subtree to
      // recover nested JSON values (e.g. a `json` field whose stored
      // shape is an object).
      const nested = unflattenSettings(flat) as {
        plugins?: Record<string, unknown>
      }
      const pluginsBlock = nested.plugins
      if (!pluginsBlock || typeof pluginsBlock !== 'object') return out

      for (const [instanceId, block] of Object.entries(pluginsBlock)) {
        if (!block || typeof block !== 'object' || Array.isArray(block)) continue
        // The block is already keyed by field key after the
        // unflatten — `plugins.foo.bar = v` becomes
        // `{ plugins: { foo: { bar: v } } }`.
        out.set(instanceId, { ...(block as Record<string, unknown>) })
      }

      return out
    },
  }
}
