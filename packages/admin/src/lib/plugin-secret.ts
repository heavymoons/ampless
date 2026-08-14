'use client'

// Admin-side helpers for `AmplessPlugin.settings.secret` (Phase 6a v2).
//
// Storage model (v2 — key in Lambda env var):
//
//   PluginSecret table (IAM-only access):
//     sk    = `plugins.${instanceId}.${fieldKey}`
//     value = base64(IV[12] || ciphertext || authTag[16]) — AES-256-GCM
//
//   PluginSecretIndicator table (admin/editor R/W):
//     sk        = `plugins.${instanceId}.${fieldKey}`
//     lastSetAt = ISO 8601 datetime
//
// Single-id identifier (no `siteId` partition column) — same convention
// as KvStore / Post / Page / Media after the `remove-siteid-from-schema`
// migration.
//
// Admin browser NEVER touches PluginSecret directly. All writes go
// through the `setPluginSecret` / `clearPluginSecret` AppSync mutations,
// which are backed by the plugin-secret-handler Lambda. The Lambda
// receives the plaintext, validates it, encrypts with the env-var key
// (PLUGIN_SECRET_ENCRYPTION_KEY, an Amplify secret), and writes the
// ciphertext to DDB. The plaintext never rests in DynamoDB and never
// flows back to the browser.
//
// hasPluginSecret reads from PluginSecretIndicator (which admin/editor
// can access) to determine existence without touching ciphertext.
//
// Storage key convention (mirrors processor-trusted.ts ctx.secret):
//   sk = `plugins.${instanceId ?? name}.${fieldKey}`

import { generateClient } from 'aws-amplify/api'
import { isValidPluginKey, validatePluginSettingValue, type PluginSecretField } from 'ampless'

/**
 * Build the PluginSecret / PluginSecretIndicator sort key.
 * Centralised here so processor-trusted.ts, plugin-secret-handler.ts,
 * and this admin lib all use the same format.
 */
export function pluginSecretKey(instanceId: string, fieldKey: string): string {
  return `plugins.${instanceId}.${fieldKey}`
}

// ---------------------------------------------------------------------------
// Internal AppSync client helpers
// ---------------------------------------------------------------------------

interface PluginSecretIndicatorRow {
  sk: string
  lastSetAt: string
}

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface MutationResult {
  data: string | null
  errors?: Array<{ message?: string }> | null
}

interface PluginSecretIndicatorModel {
  get(args: { sk: string }): Promise<ModelResult<PluginSecretIndicatorRow>>
}

interface MutationsShape {
  setPluginSecret?: (args: {
    fieldKey: string
    instanceId: string
    value: string
  }) => Promise<MutationResult>
  clearPluginSecret?: (args: {
    fieldKey: string
    instanceId: string
  }) => Promise<MutationResult>
}

interface DataClientShape {
  models: {
    PluginSecretIndicator?: PluginSecretIndicatorModel
  }
  mutations: MutationsShape
}

function requireClient(): DataClientShape {
  return generateClient() as unknown as DataClientShape
}

function requireIndicatorModel(client: DataClientShape): PluginSecretIndicatorModel {
  const m = client.models.PluginSecretIndicator
  if (!m) {
    throw new Error(
      'PluginSecretIndicator model is not available on the AppSync client. ' +
        'Did you redeploy the sandbox? Run `npx ampx sandbox` and wait ' +
        'for it to finish, then reload this page.'
    )
  }
  return m
}

function requireSetMutation(client: DataClientShape): NonNullable<MutationsShape['setPluginSecret']> {
  const fn = client.mutations.setPluginSecret
  if (!fn) {
    throw new Error(
      'setPluginSecret mutation is not available on the AppSync client. ' +
        'Ensure pluginSecretHandlerFunction is wired in amplessSchemaModels() and ' +
        'the sandbox is running.'
    )
  }
  return fn
}

function requireClearMutation(
  client: DataClientShape
): NonNullable<MutationsShape['clearPluginSecret']> {
  const fn = client.mutations.clearPluginSecret
  if (!fn) {
    throw new Error(
      'clearPluginSecret mutation is not available on the AppSync client. ' +
        'Ensure pluginSecretHandlerFunction is wired in amplessSchemaModels() and ' +
        'the sandbox is running.'
    )
  }
  return fn
}

// ---------------------------------------------------------------------------
// Public API — mutation-only write, indicator-only existence check
// ---------------------------------------------------------------------------

/**
 * Save (insert or overwrite) a secret value for one plugin field.
 *
 * Validates the field manifest constraints (`pattern`, `maxLength`,
 * `required`) **client-side only** — fast UX feedback before the
 * network round-trip. The Lambda does NOT re-validate against the
 * plugin manifest: it enforces only a generic hard cap (10,000 chars)
 * and a safe-character sanitizer. An admin/editor user calling the
 * AppSync mutation directly can therefore bypass `pattern` /
 * field-level `maxLength` / `required`. This is by design — the
 * threat model treats admin/editor as trusted operators authorised to
 * set secrets; the manifest checks here are UX guidance, not a
 * security boundary. See the Phase 6a v2.2 section of
 * https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture for the full threat
 * model.
 *
 * The plaintext is sent to the Lambda via the AppSync mutation (TLS).
 * The Lambda encrypts with AES-256-GCM using the env-var key and writes
 * only the ciphertext to DynamoDB. The value is never returned to the
 * browser.
 *
 * @param field      - The `PluginSecretField` manifest for this field.
 *                     Used for client-side validation (`maxLength`, `pattern`,
 *                     `required`).
 * @param instanceId - Plugin instance identifier.
 * @param value      - Plaintext string entered by the admin.
 */
export async function setPluginSecret(
  field: PluginSecretField,
  instanceId: string,
  value: string
): Promise<void> {
  if (!isValidPluginKey(instanceId)) {
    throw new Error(`[plugin-secret] Invalid instanceId: "${instanceId}"`)
  }
  if (!isValidPluginKey(field.key)) {
    throw new Error(`[plugin-secret] Invalid fieldKey: "${field.key}"`)
  }
  if (typeof value !== 'string') {
    throw new Error(`[plugin-secret] value must be a string`)
  }

  // Client-side validation for fast UX feedback.
  // validatePluginSettingValue accepts PluginSettingField; PluginSecretField
  // is structurally compatible (type 'text' | 'textarea', maxLength, pattern, required).
  const validated = validatePluginSettingValue(
    field as unknown as Parameters<typeof validatePluginSettingValue>[0],
    value,
    'strict'
  )
  if (validated === null) {
    throw new Error(
      `[plugin-secret] Value for field "${field.key}" failed validation (maxLength, pattern, or required constraint).`
    )
  }

  const client = requireClient()
  const mutation = requireSetMutation(client)
  const { errors } = await mutation({ fieldKey: field.key, instanceId, value })
  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message ?? 'setPluginSecret mutation failed')
  }
}

/**
 * Delete a stored secret value. Used by the "Clear" button in the
 * admin SecretFieldInput component.
 *
 * The Lambda deletes from both PluginSecret and PluginSecretIndicator.
 * If neither row exists, this is a no-op.
 */
export async function clearPluginSecret(instanceId: string, fieldKey: string): Promise<void> {
  if (!isValidPluginKey(instanceId)) {
    throw new Error(`[plugin-secret] Invalid instanceId: "${instanceId}"`)
  }
  if (!isValidPluginKey(fieldKey)) {
    throw new Error(`[plugin-secret] Invalid fieldKey: "${fieldKey}"`)
  }

  const client = requireClient()
  const mutation = requireClearMutation(client)
  const { errors } = await mutation({ fieldKey, instanceId })
  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message ?? 'clearPluginSecret mutation failed')
  }
}

/**
 * Returns `true` if a secret value has been stored for this
 * instance + field combination, `false` otherwise. **Does not
 * return the value** — the admin UI only needs to know whether a
 * value exists so it can show the "stored" placeholder (`••••••••`)
 * vs an empty input.
 *
 * Reads from PluginSecretIndicator, which admin/editor groups can
 * access. The indicator row is written (and deleted) by the
 * plugin-secret-handler Lambda in sync with the PluginSecret row.
 */
export async function hasPluginSecret(instanceId: string, fieldKey: string): Promise<boolean> {
  if (!isValidPluginKey(instanceId)) return false
  if (!isValidPluginKey(fieldKey)) return false

  try {
    const client = requireClient()
    const model = requireIndicatorModel(client)
    const sk = pluginSecretKey(instanceId, fieldKey)
    const result = await model.get({ sk })
    return result.data !== null
  } catch {
    // Any error (network, AppSync auth, model unavailable) → treat as
    // "unknown / not found" so the UI degrades gracefully.
    return false
  }
}
