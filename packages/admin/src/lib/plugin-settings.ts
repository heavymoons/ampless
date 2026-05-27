'use client'

// Admin-side helpers for `AmplessPlugin.settings.public` (Phase 2).
// Writes flow through the same KvStore provider that backs theme /
// site settings: pk='siteconfig', sk='plugins.<instanceId>.<fieldKey>'.
// The trusted processor mirrors this row to `public/site-settings.json`
// so the public runtime reads it back through `createPluginSettings`.
//
// Cache invalidation is intentionally NOT triggered here — the
// caller (the admin form) batches saves and fires a single delayed
// `invalidateSiteSettingsCache()` after the trusted processor has
// had time to rebuild the S3 cache. See
// `packages/admin/src/components/plugin-settings-form.tsx`.

import {
  getKvStore,
  SITE_CONFIG_PK,
  isValidPluginKey,
  validatePluginSettingValue,
  type PluginSettingField,
} from 'ampless'

/**
 * Storage key. Centralised so the runtime helper (`plugin-settings.ts`)
 * and admin save / delete share one format — and so any drift turns
 * into a single typecheck failure rather than silent miss.
 */
export function pluginSettingKey(instanceId: string, fieldKey: string): string {
  return `plugins.${instanceId}.${fieldKey}`
}

/** Loaded existing values for one plugin instance. Keys are field
 *  `key`s (not the full SK). */
export async function loadPluginPublicSettings(
  instanceId: string
): Promise<Record<string, unknown>> {
  if (!isValidPluginKey(instanceId)) return {}
  const store = getKvStore()
  // KvStore.query walks `pk = siteconfig` rows. We filter client-side
  // to `plugins.<instanceId>.*` so the API matches `loadSiteSettings`
  // (which already runs against the same partition and is cached
  // shape-side by AppSync per-request).
  const items = await store.query<unknown>(SITE_CONFIG_PK)
  const prefix = `plugins.${instanceId}.`
  const out: Record<string, unknown> = {}
  for (const item of items) {
    if (!item.sk.startsWith(prefix)) continue
    const fieldKey = item.sk.slice(prefix.length)
    if (!fieldKey || fieldKey.includes('.')) continue
    out[fieldKey] = item.value
  }
  return out
}

/**
 * Save (insert / update) one public setting. Validates the raw input
 * against the field manifest before writing — invalid values throw so
 * the form can surface a localised error per row.
 *
 * The field is passed (not just the key) to keep validation cohesive
 * with the manifest. Distributing it across callers would force every
 * save site to remember the field-type rules.
 */
export async function setPluginPublicSetting(
  instanceId: string,
  field: PluginSettingField,
  rawValue: unknown
): Promise<void> {
  if (!isValidPluginKey(instanceId)) {
    throw new Error(`Invalid plugin instanceId: "${instanceId}"`)
  }
  if (!isValidPluginKey(field.key)) {
    throw new Error(`Invalid plugin field key: "${field.key}"`)
  }
  const validated = validatePluginSettingValue(field, rawValue)
  if (validated === null) {
    throw new Error(`Invalid value for plugin field "${field.key}"`)
  }
  const store = getKvStore()
  await store.put(SITE_CONFIG_PK, pluginSettingKey(instanceId, field.key), validated)
}

/**
 * Delete a stored public setting. Used by the "Reset to default"
 * button on the admin form — distinct from "save empty string"
 * (which is a valid explicit value for string-like fields).
 */
export async function deletePluginPublicSetting(
  instanceId: string,
  field: PluginSettingField
): Promise<void> {
  if (!isValidPluginKey(instanceId)) {
    throw new Error(`Invalid plugin instanceId: "${instanceId}"`)
  }
  if (!isValidPluginKey(field.key)) {
    throw new Error(`Invalid plugin field key: "${field.key}"`)
  }
  const store = getKvStore()
  await store.remove(SITE_CONFIG_PK, pluginSettingKey(instanceId, field.key))
}
