'use client'

// Admin-side helpers for `AmplessPlugin.settings.secret` (Phase 6a).
//
// Storage model (updated Phase 6a follow-up):
//
//   PluginSecret table has two row kinds:
//
//   1. Encryption-key row:
//        siteId = 'default'
//        sk     = '__internal:encryption-key'
//        value  = base64(32 raw AES-256 key bytes)  — plaintext key bootstrap
//
//   2. Secret-value rows:
//        siteId = 'default'
//        sk     = `plugins.${instanceId}.${fieldKey}`
//        value  = base64(IV[12] || ciphertext || authTag[16])  — AES-256-GCM
//
// Defense in depth: admin Cognito users can read the `value` column via
// AppSync, but they only see ciphertext blobs. The plaintext never flows
// to the browser — only the encryption step happens client-side with the
// key fetched once per browser session.
//
// The trusted Lambda (Node.js) decrypts with node:crypto.
//
// Storage key convention (mirrors processor-trusted.ts ctx.secret):
//   siteId = 'default'
//   sk     = `plugins.${instanceId ?? name}.${fieldKey}`

import { generateClient } from 'aws-amplify/api'
import { isValidPluginKey, validatePluginSettingValue, type PluginSecretField } from 'ampless'

/**
 * Build the PluginSecret sort key. Centralised here so processor-trusted.ts,
 * plugin-secret.ts (admin write), and any future consumers all use the
 * same format, and any drift surfaces as a single typecheck failure.
 */
export function pluginSecretKey(instanceId: string, fieldKey: string): string {
  return `plugins.${instanceId}.${fieldKey}`
}

/** Sort key for the internal encryption-key bootstrap row. */
const ENCRYPTION_KEY_SK = '__internal:encryption-key'

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
// AES-256-GCM helpers (Web Crypto API — browser + edge, no external deps)
// ---------------------------------------------------------------------------

/**
 * Encode/decode helpers. Web Crypto `encrypt` returns
 * `ciphertext || authTag[16]` as a single ArrayBuffer, so we embed IV
 * up front: `IV[12] || ciphertext || authTag[16]` → base64.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Import a raw 32-byte AES-256-GCM key for encryption.
 * `extractable: false` — the key stays inside the SubtleCrypto store.
 */
async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  // Copy the key bytes into a plain ArrayBuffer (SubtleCrypto
  // requires ArrayBuffer, not SharedArrayBuffer). Using a typed-array
  // constructor produces a guaranteed-plain ArrayBuffer regardless of
  // the source backing store.
  const keyBuf = new Uint8Array(rawKey).buffer as ArrayBuffer
  return crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['encrypt'])
}

/**
 * Encrypt `plaintext` with AES-256-GCM.
 * Returns base64( IV[12] || ciphertext || authTag[16] ).
 * Web Crypto appends the 16-byte authTag to the ciphertext automatically.
 */
async function encryptSecret(rawKey: Uint8Array, plaintext: string): Promise<string> {
  const key = await importAesKey(rawKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plaintext)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  // Concatenate IV + encrypted (ciphertext + authTag)
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.byteLength)
  return arrayBufferToBase64(combined.buffer)
}

// ---------------------------------------------------------------------------
// Encryption key management
// ---------------------------------------------------------------------------

/**
 * Fetch or lazily create the AES-256 encryption key stored in the
 * special `__internal:encryption-key` row. The row value is the
 * base64-encoded 32 raw bytes — no encryption of the key itself
 * (bootstrap problem avoided; the key is protected by IAM / Cognito
 * access control on the AppSync endpoint and DynamoDB SSE at rest).
 *
 * Race-safety: if two tabs both call setPluginSecret simultaneously on
 * a fresh site, the second create will return an AppSync conflict error.
 * We catch that by re-fetching and using the winner's key.
 */
async function getOrCreateEncryptionKey(model: PluginSecretModel): Promise<Uint8Array> {
  // Try to read the existing key first.
  const existing = await model.get({ siteId: 'default', sk: ENCRYPTION_KEY_SK })
  if (existing.data?.value) {
    return base64ToUint8Array(existing.data.value)
  }

  // No key yet — generate one and create the row.
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  const b64Key = arrayBufferToBase64(rawKey.buffer)

  // Try to create. If another concurrent caller wins, read their key.
  const { data, errors } = await model.create({
    siteId: 'default',
    sk: ENCRYPTION_KEY_SK,
    value: b64Key,
  })
  if (data) {
    // We won the race — use our key.
    return rawKey
  }
  if (errors && errors.length > 0) {
    // Likely a DuplicateItem conflict — re-fetch and use the winner's key.
    const retry = await model.get({ siteId: 'default', sk: ENCRYPTION_KEY_SK })
    if (retry.data?.value) {
      return base64ToUint8Array(retry.data.value)
    }
    // If still no key, something is wrong — throw.
    throw new Error(
      `[plugin-secret] Failed to create or retrieve encryption key: ${errors[0]?.message ?? 'unknown error'}`
    )
  }
  // Shouldn't reach here, but fall back to our generated key.
  return rawKey
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save (insert or overwrite) a secret value for one plugin field.
 * Validates the field manifest constraints before writing. The value
 * is AES-256-GCM encrypted client-side using the site's per-site key
 * stored in the `__internal:encryption-key` row before being sent to
 * AppSync, so the plaintext never rests in DynamoDB.
 *
 * @param field     - The `PluginSecretField` manifest for this field.
 *                    Used to validate `maxLength`, `pattern`, `required`.
 * @param instanceId - Plugin instance identifier (same as the trusted
 *                    Lambda's namespace).
 * @param value     - Plaintext string entered by the admin.
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

  // Validate against manifest constraints (strict mode).
  // validatePluginSettingValue accepts PluginSettingField; PluginSecretField
  // is structurally compatible (type 'text' | 'textarea', maxLength, pattern, required).
  // Cast through unknown to bridge the type gap — the shape is identical.
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

  const model = requireModel()
  const sk = pluginSecretKey(instanceId, field.key)

  // Encrypt before persisting.
  const encKey = await getOrCreateEncryptionKey(model)
  const ciphertext = await encryptSecret(encKey, value)

  // Try update first; if the row does not exist yet, create.
  const existing = await model.get({ siteId: 'default', sk })
  if (existing.data) {
    const { errors } = await model.update({ siteId: 'default', sk, value: ciphertext })
    if (errors) throw new Error(errors[0]?.message ?? 'PluginSecret.update failed')
  } else {
    const { errors } = await model.create({ siteId: 'default', sk, value: ciphertext })
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
 * Now that admin/editor groups have `read` authorization, this call
 * returns reliable existence data from AppSync rather than falling
 * back to the absence-on-auth-error heuristic.
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
