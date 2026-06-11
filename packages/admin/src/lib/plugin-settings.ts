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

// NOTE: a previous version of this file exported a client-side
// `loadPluginPublicSettings()` that queried KvStore directly. Server
// Components can't call it (no admin KvStore provider on the server,
// and the file is `'use client'`), so `Admin.loadPluginPublicSettings`
// in `../index.ts` now goes through `ampless.pluginSettings.loadAll()`
// (S3 cache, server-safe). If a future client flow needs to re-read
// after save, add a thin client wrapper here — but the form currently
// keeps its own in-state copy of the user's edits, so no re-read is
// required.

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
  const validated = validatePluginSettingValue(field, rawValue, 'strict')
  if (validated === null) {
    throw new Error(`Invalid value for plugin field "${field.key}"`)
  }
  const store = getKvStore()
  await store.put(SITE_CONFIG_PK, pluginSettingKey(instanceId, field.key), validated)
}

/**
 * Read one stored public setting directly from DDB (via KvStore, strongly
 * consistent). Pairs with `setPluginPublicSetting` / `deletePluginPublicSetting`.
 *
 * Returns the stored value, or `null` if no row exists. Used by the
 * form's mount-time refresh to bypass the S3 snapshot lag (~60 s).
 */
export async function getPluginPublicSetting(
  instanceId: string,
  fieldKey: string
): Promise<unknown | null> {
  return getKvStore().get(SITE_CONFIG_PK, pluginSettingKey(instanceId, fieldKey))
}

/**
 * Collect the writes that a save() call would need to perform.
 *
 * Extracted as a pure function so that:
 *   1. It is unit-testable without a real form.
 *   2. The form can inspect the result before actually calling
 *      `setPluginPublicSetting` — if `writes` is empty and `invalid`
 *      is empty, the save is a no-op and the UI can say so honestly.
 *
 * Mirror of the write-collection loop in save() (plugin-settings-form.tsx).
 * Keep both in sync — the form calls this function, it no longer
 * duplicates the logic.
 */
export function collectSettingWrites(
  fields: ReadonlyArray<PluginSettingField>,
  values: Record<string, string>,
  touched: Record<string, boolean>,
  parseFn: (field: PluginSettingField, raw: string) => unknown | null
): { writes: Array<{ field: PluginSettingField; parsed: unknown }>; invalid: Record<string, boolean> } {
  const writes: Array<{ field: PluginSettingField; parsed: unknown }> = []
  const invalid: Record<string, boolean> = {}

  for (const field of fields) {
    if (!touched[field.key]) continue
    const raw = values[field.key] ?? ''
    const parsed = parseFn(field, raw)
    if (parsed === null && raw !== '') {
      invalid[field.key] = true
      continue
    }
    // parsed === null && raw === '' means "empty non-string field" — skip,
    // don't write. The Reset button handles reverting to the default.
    if (parsed === null) continue
    writes.push({ field, parsed })
  }

  return { writes, invalid }
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
