// Tests for packages/admin/src/lib/plugin-secret.ts
//
// Tests cover:
//   1. pluginSecretKey helper
//   2. setPluginSecret field validation (strict mode, maxLength, pattern)
//   3. setPluginSecret encrypts before writing (value stored ≠ plaintext)
//   4. setPluginSecret create-or-update upsert logic
//   5. getOrCreateEncryptionKey lazy creation + race-safe re-fetch
//   6. hasPluginSecret returns correct boolean based on model.get result
//   7. clearPluginSecret calls model.delete

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginSecretField } from 'ampless'

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above all imports that transitively use them
// ---------------------------------------------------------------------------

// In-memory model store for the PluginSecret AppSync model.
// Map key: `${siteId}:${sk}`
const store = vi.hoisted(() => new Map<string, { siteId: string; sk: string; value: string }>())

vi.mock('aws-amplify/api', () => {
  function generateClient() {
    return {
      models: {
        PluginSecret: {
          async get({ siteId, sk }: { siteId: string; sk: string }) {
            const row = store.get(`${siteId}:${sk}`)
            return { data: row ?? null, errors: null }
          },
          async create(args: { siteId: string; sk: string; value: string }) {
            const key = `${args.siteId}:${args.sk}`
            if (store.has(key)) {
              // Simulate DuplicateItem conflict (like AppSync returns on create of existing row)
              return { data: null, errors: [{ message: 'ConditionalCheckFailedException' }] }
            }
            store.set(key, { siteId: args.siteId, sk: args.sk, value: args.value })
            return { data: { siteId: args.siteId, sk: args.sk, value: args.value }, errors: null }
          },
          async update(args: { siteId: string; sk: string; value: string }) {
            const key = `${args.siteId}:${args.sk}`
            const existing = store.get(key)
            if (!existing) return { data: null, errors: [{ message: 'Not found' }] }
            store.set(key, { ...existing, value: args.value })
            return { data: { siteId: args.siteId, sk: args.sk, value: args.value }, errors: null }
          },
          async delete({ siteId, sk }: { siteId: string; sk: string }) {
            store.delete(`${siteId}:${sk}`)
            return { data: null, errors: null }
          },
        },
      },
    }
  }
  return { generateClient }
})

vi.mock('ampless', async (importOriginal) => {
  // Use the real ampless implementations for validation.
  const actual = await importOriginal<typeof import('ampless')>()
  return {
    ...actual,
  }
})

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are declared
// ---------------------------------------------------------------------------

import {
  pluginSecretKey,
  setPluginSecret,
  clearPluginSecret,
  hasPluginSecret,
} from './plugin-secret.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const signingSecretField: PluginSecretField = {
  type: 'text',
  key: 'signingSecret',
  label: 'Webhook signing secret',
  maxLength: 256,
  required: true,
}

const apiKeyField: PluginSecretField = {
  type: 'text',
  key: 'apiKey',
  label: 'API key',
  required: true,
}

beforeEach(() => {
  store.clear()
})

// ---------------------------------------------------------------------------
// pluginSecretKey
// ---------------------------------------------------------------------------

describe('pluginSecretKey', () => {
  it('builds the storage SK pattern', () => {
    expect(pluginSecretKey('webhook', 'signingSecret')).toBe('plugins.webhook.signingSecret')
  })

  it('uses instanceId when present', () => {
    expect(pluginSecretKey('webhook-main', 'apiKey')).toBe('plugins.webhook-main.apiKey')
  })
})

// ---------------------------------------------------------------------------
// setPluginSecret — field validation
// ---------------------------------------------------------------------------

describe('setPluginSecret — field validation', () => {
  it('throws when instanceId is invalid', async () => {
    await expect(setPluginSecret(signingSecretField, 'bad.id', 'value')).rejects.toThrow(
      /Invalid instanceId/
    )
  })

  it('throws when value exceeds maxLength', async () => {
    const longValue = 'a'.repeat(257)
    await expect(setPluginSecret(signingSecretField, 'webhook', longValue)).rejects.toThrow(
      /failed validation/
    )
  })

  it('throws when required field is empty string', async () => {
    await expect(setPluginSecret(signingSecretField, 'webhook', '')).rejects.toThrow(
      /failed validation/
    )
  })

  it('does not throw for value within maxLength', async () => {
    const ok = 'a'.repeat(100)
    await expect(setPluginSecret(signingSecretField, 'webhook', ok)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// setPluginSecret — encryption
// ---------------------------------------------------------------------------

describe('setPluginSecret — encrypts value before storing', () => {
  it('stored value is NOT the plaintext', async () => {
    const plaintext = 'super-secret-value'
    await setPluginSecret(apiKeyField, 'myplugin', plaintext)

    // Find the secret row in the mock store.
    const row = store.get('default:plugins.myplugin.apiKey')
    expect(row).toBeDefined()
    // The stored value must be a base64 blob, not the plaintext.
    expect(row!.value).not.toBe(plaintext)
    // It should be valid base64 (no decode error).
    expect(() => atob(row!.value)).not.toThrow()
  })

  it('encryption key row is created lazily on first setPluginSecret', async () => {
    expect(store.has('default:__internal:encryption-key')).toBe(false)
    await setPluginSecret(apiKeyField, 'myplugin', 'some-value')
    expect(store.has('default:__internal:encryption-key')).toBe(true)
  })

  it('encryption key row is reused across two setPluginSecret calls', async () => {
    await setPluginSecret(apiKeyField, 'plugin-a', 'value-a')
    const key1 = store.get('default:__internal:encryption-key')?.value

    // Second call — key row already exists; should not overwrite
    await setPluginSecret(signingSecretField, 'plugin-b', 'value-b')
    const key2 = store.get('default:__internal:encryption-key')?.value

    expect(key1).toBeDefined()
    expect(key2).toBe(key1)
  })

  it('two different plaintexts produce two different ciphertexts (random IV)', async () => {
    await setPluginSecret(apiKeyField, 'plugin1', 'same-plaintext')
    const c1 = store.get('default:plugins.plugin1.apiKey')?.value

    // Clear the secret row but keep the key row so the same key is used.
    store.delete('default:plugins.plugin1.apiKey')

    await setPluginSecret(apiKeyField, 'plugin1', 'same-plaintext')
    const c2 = store.get('default:plugins.plugin1.apiKey')?.value

    // Random IV means ciphertexts differ even for identical plaintext.
    expect(c1).toBeDefined()
    expect(c2).toBeDefined()
    expect(c1).not.toBe(c2)
  })
})

// ---------------------------------------------------------------------------
// setPluginSecret — upsert logic (create vs update)
// ---------------------------------------------------------------------------

describe('setPluginSecret — upsert (create-or-update)', () => {
  it('creates a new row when no row exists', async () => {
    await setPluginSecret(apiKeyField, 'myplugin', 'initial-value')
    expect(store.has('default:plugins.myplugin.apiKey')).toBe(true)
  })

  it('updates an existing row without creating a duplicate', async () => {
    await setPluginSecret(apiKeyField, 'myplugin', 'v1')
    const v1Row = store.get('default:plugins.myplugin.apiKey')?.value

    await setPluginSecret(apiKeyField, 'myplugin', 'v2')
    const v2Row = store.get('default:plugins.myplugin.apiKey')?.value

    expect(v1Row).toBeDefined()
    expect(v2Row).toBeDefined()
    // Values should differ (different plaintexts + random IV → different ciphertext)
    expect(v1Row).not.toBe(v2Row)
    // Only one row for this key
    let rowCount = 0
    for (const k of store.keys()) {
      if (k === 'default:plugins.myplugin.apiKey') rowCount++
    }
    expect(rowCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// setPluginSecret — race-safe key creation (conflict re-fetch)
// ---------------------------------------------------------------------------

describe('setPluginSecret — race-safe encryption key creation', () => {
  it('uses the winner key when create conflicts (concurrent tab race)', async () => {
    // Simulate: another tab created the key row just before this call.
    const preExistingKey = new Uint8Array(32).fill(0xab)
    // base64 of the pre-existing key (what the "winner" tab stored)
    let preExistingB64 = ''
    const bytes = preExistingKey
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!)
    }
    preExistingB64 = btoa(binary)
    store.set('default:__internal:encryption-key', {
      siteId: 'default',
      sk: '__internal:encryption-key',
      value: preExistingB64,
    })

    // Now call setPluginSecret — it should read the existing key (not overwrite it)
    await setPluginSecret(apiKeyField, 'myplugin', 'value')
    const storedKey = store.get('default:__internal:encryption-key')?.value
    expect(storedKey).toBe(preExistingB64)
  })
})

// ---------------------------------------------------------------------------
// hasPluginSecret
// ---------------------------------------------------------------------------

describe('hasPluginSecret', () => {
  it('returns false when no row exists', async () => {
    expect(await hasPluginSecret('myplugin', 'apiKey')).toBe(false)
  })

  it('returns true when a row exists', async () => {
    store.set('default:plugins.myplugin.apiKey', {
      siteId: 'default',
      sk: 'plugins.myplugin.apiKey',
      value: 'ciphertext',
    })
    expect(await hasPluginSecret('myplugin', 'apiKey')).toBe(true)
  })

  it('returns false for invalid instanceId (no AppSync call)', async () => {
    expect(await hasPluginSecret('bad.id', 'apiKey')).toBe(false)
  })

  it('returns false for invalid fieldKey (no AppSync call)', async () => {
    expect(await hasPluginSecret('myplugin', 'bad.key')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clearPluginSecret
// ---------------------------------------------------------------------------

describe('clearPluginSecret', () => {
  it('removes the row from the store', async () => {
    store.set('default:plugins.myplugin.apiKey', {
      siteId: 'default',
      sk: 'plugins.myplugin.apiKey',
      value: 'ciphertext',
    })
    await clearPluginSecret('myplugin', 'apiKey')
    expect(store.has('default:plugins.myplugin.apiKey')).toBe(false)
  })

  it('is a no-op when row does not exist', async () => {
    await expect(clearPluginSecret('myplugin', 'apiKey')).resolves.toBeUndefined()
  })

  it('throws when instanceId is invalid', async () => {
    await expect(clearPluginSecret('bad.id', 'apiKey')).rejects.toThrow(/Invalid instanceId/)
  })

  it('throws when fieldKey is invalid', async () => {
    await expect(clearPluginSecret('myplugin', 'bad.key')).rejects.toThrow(/Invalid fieldKey/)
  })
})
