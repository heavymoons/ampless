// Tests for packages/admin/src/lib/plugin-secret.ts (Phase 6a v2)
//
// v2 design: admin browser calls AppSync mutations (setPluginSecret /
// clearPluginSecret). Lambda encrypts. Admin reads existence from
// PluginSecretIndicator, NOT from PluginSecret.
//
// Tests cover:
//   1. pluginSecretKey helper
//   2. setPluginSecret — client-side field validation (fast UX feedback)
//   3. setPluginSecret — calls the AppSync mutation with correct args
//   4. setPluginSecret — no direct PluginSecret model access
//   5. hasPluginSecret — reads from PluginSecretIndicator
//   6. clearPluginSecret — calls the AppSync mutation

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginSecretField } from 'ampless'

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above all imports that transitively use them
// ---------------------------------------------------------------------------

// In-memory store for PluginSecretIndicator (what admin can read).
// Map key: `${siteId}:${sk}`
const indicatorStore = vi.hoisted(
  () => new Map<string, { siteId: string; sk: string; lastSetAt: string }>()
)

// Track mutation calls.
const mutationCalls = vi.hoisted(
  () => [] as Array<{ name: string; args: Record<string, string> }>
)

vi.mock('aws-amplify/api', () => {
  function generateClient() {
    return {
      models: {
        // PluginSecretIndicator — admin can read (existence check).
        PluginSecretIndicator: {
          async get({ siteId, sk }: { siteId: string; sk: string }) {
            const row = indicatorStore.get(`${siteId}:${sk}`)
            return { data: row ?? null, errors: null }
          },
        },
        // PluginSecret intentionally NOT present — admin lib must not use it.
      },
      mutations: {
        async setPluginSecret(args: { fieldKey: string; instanceId: string; value: string }) {
          mutationCalls.push({ name: 'setPluginSecret', args })
          return { data: 'ok', errors: null }
        },
        async clearPluginSecret(args: { fieldKey: string; instanceId: string }) {
          mutationCalls.push({ name: 'clearPluginSecret', args })
          return { data: 'ok', errors: null }
        },
      },
    }
  }
  return { generateClient }
})

vi.mock('ampless', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ampless')>()
  return { ...actual }
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
  indicatorStore.clear()
  mutationCalls.length = 0
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
// setPluginSecret — client-side field validation
// ---------------------------------------------------------------------------

describe('setPluginSecret — client-side validation', () => {
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

  it('does not throw for valid value', async () => {
    const ok = 'valid-secret-value'
    await expect(setPluginSecret(signingSecretField, 'webhook', ok)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// setPluginSecret — calls the AppSync mutation, not PluginSecret model
// ---------------------------------------------------------------------------

describe('setPluginSecret — calls AppSync mutation', () => {
  it('calls setPluginSecret mutation with correct args', async () => {
    await setPluginSecret(apiKeyField, 'myplugin', 'my-api-key')

    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0]?.name).toBe('setPluginSecret')
    expect(mutationCalls[0]?.args).toMatchObject({
      fieldKey: 'apiKey',
      instanceId: 'myplugin',
      value: 'my-api-key',
    })
  })

  it('sends the plaintext value to the mutation (not encrypted)', async () => {
    const plaintext = 'super-secret-key-12345'
    await setPluginSecret(apiKeyField, 'myplugin', plaintext)

    // The admin lib should pass the plaintext directly to the mutation;
    // encryption happens in the Lambda.
    expect(mutationCalls[0]?.args.value).toBe(plaintext)
  })

  it('does not directly access PluginSecret model', async () => {
    // The mock client's models object intentionally lacks PluginSecret.
    // setPluginSecret must not throw due to accessing it.
    await expect(setPluginSecret(apiKeyField, 'myplugin', 'value')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// hasPluginSecret — reads from PluginSecretIndicator
// ---------------------------------------------------------------------------

describe('hasPluginSecret', () => {
  it('returns false when no indicator row exists', async () => {
    expect(await hasPluginSecret('myplugin', 'apiKey')).toBe(false)
  })

  it('returns true when indicator row exists', async () => {
    indicatorStore.set('default:plugins.myplugin.apiKey', {
      siteId: 'default',
      sk: 'plugins.myplugin.apiKey',
      lastSetAt: '2026-06-01T00:00:00.000Z',
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
// clearPluginSecret — calls the AppSync mutation
// ---------------------------------------------------------------------------

describe('clearPluginSecret', () => {
  it('calls clearPluginSecret mutation with correct args', async () => {
    await clearPluginSecret('myplugin', 'apiKey')

    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0]?.name).toBe('clearPluginSecret')
    expect(mutationCalls[0]?.args).toMatchObject({
      fieldKey: 'apiKey',
      instanceId: 'myplugin',
    })
  })

  it('is a no-op when mutation returns ok (no row exists)', async () => {
    await expect(clearPluginSecret('myplugin', 'apiKey')).resolves.toBeUndefined()
  })

  it('throws when instanceId is invalid', async () => {
    await expect(clearPluginSecret('bad.id', 'apiKey')).rejects.toThrow(/Invalid instanceId/)
  })

  it('throws when fieldKey is invalid', async () => {
    await expect(clearPluginSecret('myplugin', 'bad.key')).rejects.toThrow(/Invalid fieldKey/)
  })
})
