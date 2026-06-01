'use client'

// Admin-side helpers for `AmplessPlugin.settings.secret` (Phase 6a).
//
// THREE functions only — there is intentionally NO `getPluginSecret`.
//
// Secret values are stored in the `PluginSecret` AppSync model, which
// has NO read authorization for admin / editor Cognito groups (only
// IAM-authenticated Lambda can read). This module cannot and must not
// attempt to read secret values back.
//
// Storage key convention (mirrors processor-trusted.ts ctx.secret):
//   siteId = 'default'
//   sk     = `plugins.${instanceId}.${fieldKey}`
//
// The AppSync PluginSecret model accepts create / update / delete
// from admin/editor groups. The three functions here wrap those
// operations with key validation and the correct upsert pattern.

import { generateClient } from 'aws-amplify/api'
import { isValidPluginKey } from 'ampless'

/**
 * Build the PluginSecret sort key. Centralised here so processor-trusted.ts,
 * plugin-secret.ts (admin write), and any future consumers all use the
 * same format, and any drift surfaces as a single typecheck failure.
 */
export function pluginSecretKey(instanceId: string, fieldKey: string): string {
  return `plugins.${instanceId}.${fieldKey}`
}

// ---------------------------------------------------------------------------
// Internal AppSync client helpers
// ---------------------------------------------------------------------------

interface PluginSecretRow {
  siteId: string
  sk: string
  value: string
}

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface PluginSecretModel {
  get(args: { siteId: string; sk: string }): Promise<ModelResult<PluginSecretRow>>
  create(args: Record<string, unknown>): Promise<ModelResult<PluginSecretRow>>
  update(args: Record<string, unknown>): Promise<ModelResult<PluginSecretRow>>
  delete(args: { siteId: string; sk: string }): Promise<ModelResult<PluginSecretRow>>
}

interface DataClientShape {
  models: {
    PluginSecret?: PluginSecretModel
  }
}

function requireModel(): PluginSecretModel {
  const client = generateClient() as unknown as DataClientShape
  const m = client.models.PluginSecret
  if (!m) {
    throw new Error(
      'PluginSecret model is not available on the AppSync client. ' +
        'Did you redeploy the sandbox? Run `npx ampx sandbox` and wait ' +
        'for it to finish, then reload this page.'
    )
  }
  return m
}

// ---------------------------------------------------------------------------
// Public API — write / delete / exists-check only
// ---------------------------------------------------------------------------

/**
 * Save (insert or overwrite) a secret value for one plugin field.
 * Validates both keys before writing. The AppSync model uses a
 * create-then-update pattern (same as KvStore) because there is no
 * native upsert.
 *
 * The `value` parameter is the raw plaintext string entered by the
 * admin — e.g. a webhook signing secret or an API token. It is stored
 * directly in DynamoDB; the column is AES-256 encrypted at rest by
 * AWS-managed KMS.
 */
export async function setPluginSecret(
  instanceId: string,
  fieldKey: string,
  value: string
): Promise<void> {
  if (!isValidPluginKey(instanceId)) {
    throw new Error(`[plugin-secret] Invalid instanceId: "${instanceId}"`)
  }
  if (!isValidPluginKey(fieldKey)) {
    throw new Error(`[plugin-secret] Invalid fieldKey: "${fieldKey}"`)
  }
  if (typeof value !== 'string') {
    throw new Error(`[plugin-secret] value must be a string`)
  }

  const model = requireModel()
  const sk = pluginSecretKey(instanceId, fieldKey)

  // Try update first; if the row does not exist yet, create.
  const existing = await model.get({ siteId: 'default', sk })
  if (existing.data) {
    const { errors } = await model.update({ siteId: 'default', sk, value })
    if (errors) throw new Error(errors[0]?.message ?? 'PluginSecret.update failed')
  } else {
    const { errors } = await model.create({ siteId: 'default', sk, value })
    if (errors) throw new Error(errors[0]?.message ?? 'PluginSecret.create failed')
  }
}

/**
 * Delete a stored secret value. Used by the "Clear" button in the
 * admin SecretFieldInput component. If the row does not exist, this
 * is a no-op (AppSync delete on a non-existent identifier returns null
 * data but no error).
 */
export async function clearPluginSecret(instanceId: string, fieldKey: string): Promise<void> {
  if (!isValidPluginKey(instanceId)) {
    throw new Error(`[plugin-secret] Invalid instanceId: "${instanceId}"`)
  }
  if (!isValidPluginKey(fieldKey)) {
    throw new Error(`[plugin-secret] Invalid fieldKey: "${fieldKey}"`)
  }

  const model = requireModel()
  const sk = pluginSecretKey(instanceId, fieldKey)
  const { errors } = await model.delete({ siteId: 'default', sk })
  if (errors) throw new Error(errors[0]?.message ?? 'PluginSecret.delete failed')
}

/**
 * Returns `true` if a secret value has been stored for this
 * instance + field combination, `false` otherwise. **Does not
 * return the value** — the admin UI only needs to know whether a
 * value exists so it can show the "stored" placeholder (`••••••••`)
 * vs an empty input.
 *
 * Implementation: a `get` call on the PluginSecret model. Because
 * admin/editor groups have no `read` authorization on PluginSecret,
 * this call will return `null` data and possibly errors. In that
 * case we fall back to the `data === null` check to infer absence.
 * If AppSync schema-level denies the read, the function returns
 * `false` (no stored value, or unable to determine). Practically,
 * the admin UI degrades gracefully: it shows an empty input instead
 * of the "stored" indicator.
 *
 * NOTE: This is a best-effort existence check. A `true` result means
 * "the row exists in DynamoDB"; a `false` result means "the row does
 * not exist or the read was denied". The admin UI must handle `false`
 * conservatively (show empty input) rather than assuming the secret
 * is absent.
 */
export async function hasPluginSecret(instanceId: string, fieldKey: string): Promise<boolean> {
  if (!isValidPluginKey(instanceId)) return false
  if (!isValidPluginKey(fieldKey)) return false

  try {
    const model = requireModel()
    const sk = pluginSecretKey(instanceId, fieldKey)
    const result = await model.get({ siteId: 'default', sk })
    return result.data !== null
  } catch {
    // Any error (network, AppSync auth, model unavailable) → treat as
    // "unknown / not found" so the UI degrades gracefully.
    return false
  }
}
