// Tests for packages/backend/src/functions/plugin-secret-handler.ts
//
// Coverage:
//   1. Cognito group check (admin/editor OK; viewer/no-group reject)
//   2. Field validation in strict mode (maxLength bypass, invalid chars)
//   3. sanitizedValue (not raw value) is encrypted
//   4. encrypt → DDB PutItem shape (PluginSecret + PluginSecretIndicator)
//   5. clearPluginSecret: both tables get DeleteItem
//   6. encryptSecret round-trip with decryptSecret (node:crypto)
//   7. dual-write integrity: partial failures leave predictable state
//
// v2.2: Key source is process.env.PLUGIN_SECRET_ENCRYPTION_KEY (no SSM).

import { createDecipheriv } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory DDB store for PutItem / DeleteItem
// ---------------------------------------------------------------------------

interface DdbItem {
  siteId: string
  sk: string
  [k: string]: unknown
}

const secretStore = vi.hoisted(() => new Map<string, DdbItem>())
const indicatorStore = vi.hoisted(() => new Map<string, DdbItem>())

// Track every DDB command sent for shape assertions.
const ddbCommands = vi.hoisted(
  () => [] as Array<{ name: string; input: Record<string, unknown> }>
)

// 32 bytes of base64 — a predictable key for test assertions
const TEST_KEY_BYTES = vi.hoisted(() => Buffer.alloc(32, 0xcc))
const TEST_KEY_B64 = vi.hoisted(() => TEST_KEY_BYTES.toString('base64'))

// Set env vars via vi.hoisted() so they are available before the module under
// test is evaluated (ESM import declarations are hoisted to the top of the file
// and run before any regular code, including setEnv() calls in the module body).
vi.hoisted(() => {
  process.env.PLUGIN_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 0xcc).toString('base64')
  process.env.AMPLESS_PLUGIN_SECRET_TABLE = 'plugin-secrets'
  process.env.AMPLESS_PLUGIN_SECRET_INDICATOR_TABLE = 'plugin-secret-indicators'
})

vi.mock('@aws-sdk/client-dynamodb', () => {
  class PutItemCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
    get ['constructor']() {
      return { name: 'PutItemCommand' }
    }
  }

  class DeleteItemCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
    get ['constructor']() {
      return { name: 'DeleteItemCommand' }
    }
  }

  class DynamoDBClient {
    async send(command: PutItemCommand | DeleteItemCommand) {
      const name = command.constructor.name
      ddbCommands.push({ name, input: command.input as Record<string, unknown> })

      const item = command.input as {
        TableName: string
        Item?: Record<string, { S?: string }>
        Key?: Record<string, { S?: string }>
      }

      // Unmarshal helper (S-only for these tests)
      function unm(m: Record<string, { S?: string }>): DdbItem {
        const out: DdbItem = { siteId: '', sk: '' }
        for (const [k, v] of Object.entries(m)) {
          out[k] = v.S ?? v
        }
        return out
      }

      const secretTable = process.env.AMPLESS_PLUGIN_SECRET_TABLE ?? 'plugin-secrets'
      const indicatorTable =
        process.env.AMPLESS_PLUGIN_SECRET_INDICATOR_TABLE ?? 'plugin-secret-indicators'

      if (name === 'PutItemCommand' && item.Item) {
        const row = unm(item.Item)
        const mapKey = `${row.siteId}:${row.sk}`
        if (item.TableName === secretTable) {
          secretStore.set(mapKey, row)
        } else if (item.TableName === indicatorTable) {
          indicatorStore.set(mapKey, row)
        }
      }

      if (name === 'DeleteItemCommand' && item.Key) {
        const row = unm(item.Key)
        const mapKey = `${row.siteId}:${row.sk}`
        if (item.TableName === secretTable) {
          secretStore.delete(mapKey)
        } else if (item.TableName === indicatorTable) {
          indicatorStore.delete(mapKey)
        }
      }

      return {}
    }
  }

  return { DynamoDBClient, PutItemCommand, DeleteItemCommand }
})

// ---------------------------------------------------------------------------
// DynamoDB marshalling mock — keeps the stored Item shape close to the SDK
// enough for handler tests without pulling in the real util-dynamodb runtime.
// ---------------------------------------------------------------------------

vi.mock('@aws-sdk/util-dynamodb', () => {
  function marshall(obj: Record<string, unknown>): Record<string, { S?: string; N?: string }> {
    const result: Record<string, { S?: string; N?: string }> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') result[k] = { S: v }
      else if (typeof v === 'number') result[k] = { N: String(v) }
    }
    return result
  }
  return { marshall }
})

vi.mock('ampless', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ampless')>()
  return { ...actual }
})

// Note: env vars are set via vi.hoisted() above (before module evaluation).
// The setEnv() / setEnv() call approach does not work for module-level throws
// in ESM because import declarations are hoisted past any regular code.

// ---------------------------------------------------------------------------
// Import module under test AFTER env + mocks
// ---------------------------------------------------------------------------

import { handler, encryptSecret } from './plugin-secret-handler.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HandlerEvent = Parameters<typeof handler>[0]
type HandlerCallback = Parameters<typeof handler>[2]

function makeEvent(
  fieldName: string,
  args: Record<string, string>,
  groups: string[] = ['ampless-admin']
): HandlerEvent {
  return {
    typeName: 'Mutation',
    fieldName,
    arguments: args,
    identity: { sub: 'user-1', username: 'admin@example.com', groups },
  } as unknown as HandlerEvent
}

const cb: HandlerCallback = vi.fn() as unknown as HandlerCallback

// ---------------------------------------------------------------------------
// Decrypt helper that mirrors processor-trusted.ts decryptSecret
// ---------------------------------------------------------------------------

function decryptForTest(rawKey: Buffer, b64: string): string {
  const combined = Buffer.from(b64, 'base64')
  const iv = combined.subarray(0, 12)
  const authTag = combined.subarray(combined.byteLength - 16)
  const ciphertext = combined.subarray(12, combined.byteLength - 16)
  const decipher = createDecipheriv('aes-256-gcm', rawKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// ---------------------------------------------------------------------------
// 1. Group check
// ---------------------------------------------------------------------------

describe('plugin-secret-handler — group check', () => {
  beforeEach(() => {
    secretStore.clear()
    indicatorStore.clear()
    ddbCommands.length = 0
  })

  it('allows ampless-admin', async () => {
    const evt = makeEvent(
      'setPluginSecret',
      { fieldKey: 'signingSecret', instanceId: 'webhook', value: 'abc123' },
      ['ampless-admin']
    )
    await expect(handler(evt, {} as never, cb)).resolves.toBe('ok')
  })

  it('allows ampless-editor', async () => {
    const evt = makeEvent(
      'setPluginSecret',
      { fieldKey: 'signingSecret', instanceId: 'webhook', value: 'abc123' },
      ['ampless-editor']
    )
    await expect(handler(evt, {} as never, cb)).resolves.toBe('ok')
  })

  it('rejects caller with no groups', async () => {
    const evt = makeEvent(
      'setPluginSecret',
      { fieldKey: 'signingSecret', instanceId: 'webhook', value: 'abc123' },
      []
    )
    await expect(handler(evt, {} as never, cb)).rejects.toThrow(/Unauthorized/)
  })

  it('rejects caller in unrelated group', async () => {
    const evt = makeEvent(
      'setPluginSecret',
      { fieldKey: 'signingSecret', instanceId: 'webhook', value: 'abc123' },
      ['some-other-group']
    )
    await expect(handler(evt, {} as never, cb)).rejects.toThrow(/Unauthorized/)
  })

  it('rejects caller with no identity', async () => {
    const evt = {
      typeName: 'Mutation',
      fieldName: 'setPluginSecret',
      arguments: { fieldKey: 'signingSecret', instanceId: 'webhook', value: 'abc123' },
    } as unknown as HandlerEvent
    await expect(handler(evt, {} as never, cb)).rejects.toThrow(/Unauthorized/)
  })
})

// ---------------------------------------------------------------------------
// 2. Field validation (strict mode)
// ---------------------------------------------------------------------------

describe('plugin-secret-handler — field validation', () => {
  beforeEach(() => {
    secretStore.clear()
    indicatorStore.clear()
    ddbCommands.length = 0
  })

  it('rejects value exceeding the 10 000-char server cap', async () => {
    const longValue = 'a'.repeat(10001)
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'apiKey',
      instanceId: 'myplugin',
      value: longValue,
    })
    await expect(handler(evt, {} as never, cb)).rejects.toThrow(/failed validation/)
  })

  it('accepts value within the 10 000-char cap', async () => {
    const okValue = 'a'.repeat(100)
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'apiKey',
      instanceId: 'myplugin',
      value: okValue,
    })
    await expect(handler(evt, {} as never, cb)).resolves.toBe('ok')
  })

  it('rejects invalid instanceId', async () => {
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'apiKey',
      instanceId: 'bad.instance',
      value: 'val',
    })
    await expect(handler(evt, {} as never, cb)).rejects.toThrow(/Invalid instanceId/)
  })

  it('rejects invalid fieldKey', async () => {
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'bad.key',
      instanceId: 'myplugin',
      value: 'val',
    })
    await expect(handler(evt, {} as never, cb)).rejects.toThrow(/Invalid fieldKey/)
  })
})

// ---------------------------------------------------------------------------
// 3. Sanitized value is encrypted (not raw value with stripped chars)
// ---------------------------------------------------------------------------

describe('plugin-secret-handler — sanitized value encrypted', () => {
  beforeEach(() => {
    secretStore.clear()
    indicatorStore.clear()
    ddbCommands.length = 0
  })

  it('strips angle brackets from value before encrypting', async () => {
    // validatePluginSettingValue strips '<' and '>' (control chars / angle brackets).
    // The encrypted value should NOT contain '<script>' etc.
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'apiKey',
      instanceId: 'myplugin',
      value: 'abc<script>alert(1)</script>def',
    })
    await handler(evt, {} as never, cb)

    const row = secretStore.get('default:plugins.myplugin.apiKey')
    expect(row).toBeDefined()
    const decrypted = decryptForTest(TEST_KEY_BYTES, row!.value as string)
    // Angle brackets stripped; script tags become 'script' content without tag delimiters
    expect(decrypted).not.toContain('<')
    expect(decrypted).not.toContain('>')
    // Core alphanumeric content preserved
    expect(decrypted).toContain('abc')
    expect(decrypted).toContain('def')
  })

  it('stores encrypted blob, not plaintext', async () => {
    const plaintext = 'my-secret-api-key-1234'
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'apiKey',
      instanceId: 'myplugin',
      value: plaintext,
    })
    await handler(evt, {} as never, cb)

    const row = secretStore.get('default:plugins.myplugin.apiKey')
    expect(row).toBeDefined()
    expect(row!.value).not.toBe(plaintext)
    // Valid base64
    expect(() => Buffer.from(row!.value as string, 'base64')).not.toThrow()
    // Decrypts correctly
    const decrypted = decryptForTest(TEST_KEY_BYTES, row!.value as string)
    expect(decrypted).toBe(plaintext)
  })
})

// ---------------------------------------------------------------------------
// 4. DDB PutItem shape (both tables written)
// ---------------------------------------------------------------------------

describe('plugin-secret-handler — DDB write shape', () => {
  beforeEach(() => {
    secretStore.clear()
    indicatorStore.clear()
    ddbCommands.length = 0
  })

  it('writes PluginSecret row with siteId=default and correct sk', async () => {
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'signingSecret',
      instanceId: 'webhook',
      value: 'my-secret',
    })
    await handler(evt, {} as never, cb)

    const row = secretStore.get('default:plugins.webhook.signingSecret')
    expect(row?.siteId).toBe('default')
    expect(row?.sk).toBe('plugins.webhook.signingSecret')
    expect(typeof row?.value).toBe('string')
  })

  it('also writes PluginSecretIndicator row with lastSetAt', async () => {
    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'signingSecret',
      instanceId: 'webhook',
      value: 'my-secret',
    })
    await handler(evt, {} as never, cb)

    const row = indicatorStore.get('default:plugins.webhook.signingSecret')
    expect(row?.siteId).toBe('default')
    expect(row?.sk).toBe('plugins.webhook.signingSecret')
    expect(typeof row?.lastSetAt).toBe('string')
    // lastSetAt should be an ISO 8601 string
    expect(new Date(row!.lastSetAt as string).getTime()).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 5. clearPluginSecret: both tables get DeleteItem
// ---------------------------------------------------------------------------

describe('plugin-secret-handler — clearPluginSecret', () => {
  beforeEach(() => {
    secretStore.clear()
    indicatorStore.clear()
    ddbCommands.length = 0
  })

  it('removes rows from both tables', async () => {
    // Seed both stores
    secretStore.set('default:plugins.webhook.signingSecret', {
      siteId: 'default',
      sk: 'plugins.webhook.signingSecret',
      value: 'ciphertext',
    })
    indicatorStore.set('default:plugins.webhook.signingSecret', {
      siteId: 'default',
      sk: 'plugins.webhook.signingSecret',
      lastSetAt: '2026-06-01T00:00:00.000Z',
    })

    const evt = makeEvent('clearPluginSecret', {
      fieldKey: 'signingSecret',
      instanceId: 'webhook',
    })
    await handler(evt, {} as never, cb)

    expect(secretStore.has('default:plugins.webhook.signingSecret')).toBe(false)
    expect(indicatorStore.has('default:plugins.webhook.signingSecret')).toBe(false)
  })

  it('is a no-op when rows do not exist', async () => {
    const evt = makeEvent('clearPluginSecret', {
      fieldKey: 'signingSecret',
      instanceId: 'webhook',
    })
    await expect(handler(evt, {} as never, cb)).resolves.toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// 6. encryptSecret round-trip
// ---------------------------------------------------------------------------

describe('encryptSecret — round-trip with decryptSecret logic', () => {
  it('encrypts and decrypts correctly', () => {
    const plaintext = 'round-trip-test-value'
    const ciphertext = encryptSecret(TEST_KEY_BYTES, plaintext)
    const decrypted = decryptForTest(TEST_KEY_BYTES, ciphertext)
    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext'
    const c1 = encryptSecret(TEST_KEY_BYTES, plaintext)
    const c2 = encryptSecret(TEST_KEY_BYTES, plaintext)
    expect(c1).not.toBe(c2)
  })

  it('encrypted blob is valid base64', () => {
    const c = encryptSecret(TEST_KEY_BYTES, 'test')
    expect(() => Buffer.from(c, 'base64')).not.toThrow()
    // Minimum length: 12 (IV) + 0 (ciphertext) + 16 (authTag) = 28 bytes → ~40 chars base64
    expect(Buffer.from(c, 'base64').byteLength).toBeGreaterThanOrEqual(28)
  })
})

// ---------------------------------------------------------------------------
// 7. Dual-write integrity: partial failures leave predictable state
//
// The set and clear operations each write to two DynamoDB tables in
// sequence.  If the second write fails the first write has already
// committed, leaving the two tables temporarily inconsistent.
//
// Documented invariants (safety analysis):
//   set path:
//     PluginSecret PutItem succeeds, PluginSecretIndicator PutItem fails
//     → ciphertext exists in PluginSecret, no indicator row.
//     Effect: hasPluginSecret() returns false (UI shows "not saved"),
//             ctx.secret() returns the decrypted value (function works).
//             Consequence: minor UI inaccuracy; functionally safe.
//
//   clear path:
//     PluginSecret DeleteItem succeeds, PluginSecretIndicator DeleteItem fails
//     → ciphertext gone from PluginSecret, stale indicator remains.
//     Effect: hasPluginSecret() returns true (UI shows "saved"),
//             ctx.secret() returns undefined (function doesn't fire).
//             Consequence: stale indicator is a "safe side" false positive;
//             the secret is actually gone.
// ---------------------------------------------------------------------------

describe('plugin-secret-handler — dual-write integrity', () => {
  beforeEach(() => {
    secretStore.clear()
    indicatorStore.clear()
    ddbCommands.length = 0
  })

  it('set path partial failure: secret written, indicator absent — ctx.secret works, hasPluginSecret false', async () => {
    // Simulate: PluginSecret PutItem succeeds, PluginSecretIndicator PutItem fails.
    // We achieve this by intercepting the second PutItem command (indicator table)
    // and throwing, while letting the first succeed normally.
    let putCallCount = 0
    const originalSecretSet = secretStore.set.bind(secretStore)
    const originalIndicatorSet = indicatorStore.set.bind(indicatorStore)

    // Spy on indicatorStore.set to simulate the failure
    const indicatorSpy = vi
      .spyOn(indicatorStore, 'set')
      .mockImplementationOnce(() => {
        putCallCount++
        throw new Error('simulated DDB failure on indicator table')
      })

    const evt = makeEvent('setPluginSecret', {
      fieldKey: 'signingSecret',
      instanceId: 'webhook',
      value: 'test-secret',
    })

    // The handler should throw because the indicator write failed
    await expect(handler(evt, {} as never, cb)).rejects.toThrow()
    indicatorSpy.mockRestore()

    // PluginSecret row exists (ciphertext was written before the failure)
    const secretRow = secretStore.get('default:plugins.webhook.signingSecret')
    expect(secretRow).toBeDefined()
    const decrypted = decryptForTest(TEST_KEY_BYTES, secretRow!.value as string)
    expect(decrypted).toBe('test-secret')

    // PluginSecretIndicator row is absent (write was intercepted before it wrote)
    const indicatorRow = indicatorStore.get('default:plugins.webhook.signingSecret')
    expect(indicatorRow).toBeUndefined()
    void originalSecretSet
    void originalIndicatorSet
    void putCallCount
  })

  it('clear path partial failure: secret deleted, indicator stale — ctx.secret returns undefined, hasPluginSecret true', async () => {
    // Seed both stores to simulate existing data
    secretStore.set('default:plugins.webhook.signingSecret', {
      siteId: 'default',
      sk: 'plugins.webhook.signingSecret',
      value: 'some-ciphertext',
    })
    indicatorStore.set('default:plugins.webhook.signingSecret', {
      siteId: 'default',
      sk: 'plugins.webhook.signingSecret',
      lastSetAt: '2026-06-01T00:00:00.000Z',
    })

    // Simulate: PluginSecret DeleteItem succeeds, PluginSecretIndicator DeleteItem fails
    const indicatorSpy = vi
      .spyOn(indicatorStore, 'delete')
      .mockImplementationOnce(() => {
        throw new Error('simulated DDB failure on indicator delete')
      })

    const evt = makeEvent('clearPluginSecret', {
      fieldKey: 'signingSecret',
      instanceId: 'webhook',
    })

    // Handler throws because indicator delete failed
    await expect(handler(evt, {} as never, cb)).rejects.toThrow()
    indicatorSpy.mockRestore()

    // PluginSecret row is gone (first delete succeeded)
    expect(secretStore.has('default:plugins.webhook.signingSecret')).toBe(false)

    // PluginSecretIndicator row still exists (second delete was intercepted)
    expect(indicatorStore.has('default:plugins.webhook.signingSecret')).toBe(true)

    // Invariant:
    // - hasPluginSecret reads from PluginSecretIndicator → returns true (stale)
    // - ctx.secret reads from PluginSecret → returns undefined (row deleted)
    // This is the "safe side": UI shows "saved" but secret doesn't fire.
  })
})
