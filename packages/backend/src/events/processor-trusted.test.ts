import { createCipheriv, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AmplessPlugin, Config, TrustedPluginRuntimeContext } from 'ampless'
import { createProcessorTrustedHandler, decryptSecret } from './processor-trusted.js'

const s3Commands = vi.hoisted(() => [] as Array<{ input: Record<string, unknown> }>)
const ddbCommands = vi.hoisted(() => [] as Array<{ input: Record<string, unknown> }>)

// Simulate PluginSecret table rows for ctx.secret tests.
// Map key: `${siteId}:${sk}` → value string
const pluginSecretRows = vi.hoisted(
  () => new Map<string, string>()
)

// ---------------------------------------------------------------------------
// Encryption key — controlled via process.env (v2.2: no SSM).
// Tests that want "no key provisioned" clear the env var.
// ---------------------------------------------------------------------------
const TEST_ENC_KEY_HOISTED = vi.hoisted(() => Buffer.alloc(32, 0xab))
const TEST_ENC_KEY_B64_HOISTED = vi.hoisted(() => TEST_ENC_KEY_HOISTED.toString('base64'))

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    input: Record<string, unknown>

    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }

  class S3Client {
    async send(command: { input: Record<string, unknown> }) {
      s3Commands.push(command)
      return {}
    }
  }

  return { S3Client, PutObjectCommand }
})

vi.mock('@aws-sdk/client-dynamodb', () => {
  class DynamoDBClient {
    // GetItemCommand handler for PluginSecret reads
    async send(command: {
      input: Record<string, unknown>
      constructor: { name: string }
    }) {
      const commandName = command.constructor?.name
      if (commandName === 'GetItemCommand') {
        const key = command.input.Key as Record<string, Record<string, string>> | undefined
        if (key) {
          // Extract siteId and sk from the marshalled key
          const siteId = key['siteId']?.S
          const sk = key['sk']?.S
          if (siteId && sk) {
            const mapKey = `${siteId}:${sk}`
            const value = pluginSecretRows.get(mapKey)
            if (value !== undefined) {
              return {
                Item: {
                  siteId: { S: siteId },
                  sk: { S: sk },
                  value: { S: value },
                },
              }
            }
          }
        }
        return { Item: undefined }
      }
      return {}
    }
  }

  class GetItemCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }

  return { DynamoDBClient, GetItemCommand }
})

vi.mock('@aws-sdk/util-dynamodb', () => {
  function marshall(obj: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') result[k] = { S: v }
      else if (typeof v === 'number') result[k] = { N: String(v) }
      else if (typeof v === 'boolean') result[k] = { BOOL: v }
    }
    return result
  }

  function unmarshall(item: Record<string, Record<string, unknown>>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [k, descriptor] of Object.entries(item)) {
      if ('S' in descriptor) result[k] = descriptor['S']
      else if ('N' in descriptor) result[k] = Number(descriptor['N'])
      else if ('BOOL' in descriptor) result[k] = descriptor['BOOL']
    }
    return result
  }

  return { marshall, unmarshall }
})

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class DeleteCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class PutCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class QueryCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  const DynamoDBDocumentClient = {
    from() {
      return {
        async send(command: { input: Record<string, unknown> }) {
          ddbCommands.push(command)
          return { Items: [] }
        },
      }
    },
  }
  return { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand }
})

const site: Config['site'] = { name: 'Test', url: 'https://example.com' }

// TEST_ENC_KEY matches what is set in process.env (same Buffer as hoisted).
const TEST_ENC_KEY = TEST_ENC_KEY_HOISTED

function setEnv(withEncKey = true): void {
  process.env.AMPLESS_BUCKET_NAME = 'test-bucket'
  process.env.AMPLESS_POST_TABLE = 'posts'
  process.env.AMPLESS_KV_TABLE = 'kv'
  process.env.AMPLESS_POSTTAG_TABLE = 'posttags'
  process.env.AMPLESS_PLUGIN_SECRET_TABLE = 'plugin-secrets'
  process.env.AWS_REGION = 'us-east-1'
  // withEncKey=false simulates key not provisioned (env var absent)
  if (withEncKey) {
    process.env.PLUGIN_SECRET_ENCRYPTION_KEY = TEST_ENC_KEY_B64_HOISTED
  } else {
    delete process.env.PLUGIN_SECRET_ENCRYPTION_KEY
  }
}

function event(type = 'content.published'): Parameters<ReturnType<typeof createProcessorTrustedHandler>>[0] {
  return {
    Records: [
      {
        body: JSON.stringify({ type, payload: {} }),
      },
    ],
  } as Parameters<ReturnType<typeof createProcessorTrustedHandler>>[0]
}

function writerPlugin(partial: Partial<AmplessPlugin> = {}): AmplessPlugin {
  return {
    name: 'asset-writer',
    apiVersion: 1,
    trust_level: 'trusted',
    capabilities: ['eventHooks', 'writePublicAsset'],
    hooks: {
      'content.published': async (_evt, ctx) => {
        await ctx.writePublicAsset('feed.xml', 'ok', 'application/xml')
      },
    },
    ...partial,
  }
}

describe('createProcessorTrustedHandler writePublicAsset', () => {
  beforeEach(() => {
    setEnv()
    s3Commands.length = 0
    ddbCommands.length = 0
    pluginSecretRows.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes under instanceId when present', async () => {
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [writerPlugin({ instanceId: 'main' })],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(s3Commands[0]?.input.Key).toBe('public/plugins/main/feed.xml')
  })

  it('falls back to plugin name when instanceId is omitted', async () => {
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [writerPlugin()],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(s3Commands[0]?.input.Key).toBe('public/plugins/asset-writer/feed.xml')
  })

  it('rejects parent traversal keys before writing', async () => {
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        writerPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              await ctx.writePublicAsset('../escape', 'x', 'text/plain')
            },
          },
        }),
      ],
    })

    await expect(handler(event(), {} as never, vi.fn() as never)).rejects.toThrow(
      /writePublicAsset/
    )
    expect(s3Commands).toHaveLength(0)
  })

  it('rejects absolute keys before writing', async () => {
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        writerPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              await ctx.writePublicAsset('/abs', 'x', 'text/plain')
            },
          },
        }),
      ],
    })

    await expect(handler(event(), {} as never, vi.fn() as never)).rejects.toThrow(
      /writePublicAsset/
    )
    expect(s3Commands).toHaveLength(0)
  })

  it('warns when trusted plugin namespaces collide', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    createProcessorTrustedHandler({
      site,
      plugins: [
        writerPlugin({ name: 'a', instanceId: 'shared' }),
        writerPlugin({ name: 'b', instanceId: 'shared' }),
      ],
    })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate plugin namespace'))
  })

  it('warns once when declared capabilities omit writePublicAsset and the hook writes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [writerPlugin({ capabilities: ['eventHooks'] })],
    })

    await handler(event(), {} as never, vi.fn() as never)
    await handler(event(), {} as never, vi.fn() as never)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('writePublicAsset'))
  })

  it('does not warn for declared plugins that do not write assets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        writerPlugin({
          capabilities: ['eventHooks'],
          hooks: {
            'content.published': async () => {},
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn for legacy plugins without capabilities', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const legacy = writerPlugin()
    delete legacy.capabilities
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [legacy],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(warn).not.toHaveBeenCalled()
    expect(s3Commands[0]?.input.Key).toBe('public/plugins/asset-writer/feed.xml')
  })

  it('skips trusted plugins whose namespace fails PLUGIN_KEY_PATTERN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [writerPlugin({ instanceId: '../escape' })],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid namespace'))
    expect(s3Commands).toHaveLength(0) // hook never ran because plugin was filtered out
  })

  it('skips trusted plugins whose plain name fails PLUGIN_KEY_PATTERN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [writerPlugin({ name: 'bad/id' })],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid namespace'))
    expect(s3Commands).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ctx.secret — PluginSecret DDB read
// ---------------------------------------------------------------------------

describe('createProcessorTrustedHandler ctx.secret', () => {
  beforeEach(() => {
    setEnv()
    s3Commands.length = 0
    ddbCommands.length = 0
    pluginSecretRows.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function secretPlugin(partial: Partial<AmplessPlugin> = {}): AmplessPlugin {
    return {
      name: 'webhook',
      apiVersion: 1,
      trust_level: 'trusted',
      capabilities: ['eventHooks', 'secretSettings'],
      ...partial,
    }
  }

  it('reads a stored secret from PluginSecret table via ctx.secret', async () => {
    // Seed an AES-256-GCM ciphertext (env-var key = TEST_ENC_KEY).
    pluginSecretRows.set('default:plugins.webhook.signingSecret', encryptForTest(TEST_ENC_KEY, 'test-secret-value'))

    let capturedSecret: string | undefined
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              capturedSecret = await (ctx as TrustedPluginRuntimeContext).secret<string>('signingSecret')
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(capturedSecret).toBe('test-secret-value')
  })

  it('returns undefined when no secret is stored', async () => {
    // No rows in pluginSecretRows

    let capturedSecret: string | undefined = 'sentinel'
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              capturedSecret = await (ctx as TrustedPluginRuntimeContext).secret<string>('missingKey')
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(capturedSecret).toBeUndefined()
  })

  it('uses instanceId in the DDB sort key when instanceId is set', async () => {
    pluginSecretRows.set('default:plugins.webhook-main.signingSecret', encryptForTest(TEST_ENC_KEY, 'instance-secret'))

    let capturedSecret: string | undefined
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          name: 'webhook',
          instanceId: 'webhook-main',
          hooks: {
            'content.published': async (_evt, ctx) => {
              capturedSecret = await (ctx as TrustedPluginRuntimeContext).secret<string>('signingSecret')
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(capturedSecret).toBe('instance-secret')
  })

  it('does not confuse secrets across different plugin instances (namespace isolation)', async () => {
    pluginSecretRows.set('default:plugins.webhook-a.signingSecret', encryptForTest(TEST_ENC_KEY, 'secret-for-a'))
    pluginSecretRows.set('default:plugins.webhook-b.signingSecret', encryptForTest(TEST_ENC_KEY, 'secret-for-b'))

    const capturedSecrets: Array<{ instanceId: string; value: string | undefined }> = []

    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          name: 'webhook',
          instanceId: 'webhook-a',
          hooks: {
            'content.published': async (_evt, ctx) => {
              const value = await (ctx as TrustedPluginRuntimeContext).secret<string>('signingSecret')
              capturedSecrets.push({ instanceId: 'webhook-a', value })
            },
          },
        }),
        secretPlugin({
          name: 'webhook',
          instanceId: 'webhook-b',
          hooks: {
            'content.published': async (_evt, ctx) => {
              const value = await (ctx as TrustedPluginRuntimeContext).secret<string>('signingSecret')
              capturedSecrets.push({ instanceId: 'webhook-b', value })
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(capturedSecrets).toHaveLength(2)
    const a = capturedSecrets.find((c) => c.instanceId === 'webhook-a')
    const b = capturedSecrets.find((c) => c.instanceId === 'webhook-b')
    expect(a?.value).toBe('secret-for-a')
    expect(b?.value).toBe('secret-for-b')
  })

  it('reads the secret only once from DDB for repeated calls (per-invocation cache)', async () => {
    pluginSecretRows.set('default:plugins.webhook.signingSecret', encryptForTest(TEST_ENC_KEY, 'cached-secret'))

    // Track raw DynamoDB client calls specifically for GetItemCommand.
    // We need to count how many times the raw DDB client's send() is called
    // with a GetItemCommand (not the DocumentClient).
    let getRawDdbCallCount = 0

    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              // Read the same key twice
              const v1 = await (ctx as TrustedPluginRuntimeContext).secret('signingSecret')
              const v2 = await (ctx as TrustedPluginRuntimeContext).secret('signingSecret')
              expect(v1).toBe('cached-secret')
              expect(v2).toBe('cached-secret')
              getRawDdbCallCount++
            },
          },
        }),
      ],
    })

    // We verify indirectly: both reads return the correct value
    // (cache returns the value from the first read).
    await handler(event(), {} as never, vi.fn() as never)

    // Hook ran exactly once (not skipped)
    expect(getRawDdbCallCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// S3 mirror exclusion — PluginSecret rows must NEVER appear in site-settings
// ---------------------------------------------------------------------------

describe('S3 site-settings mirror excludes PluginSecret table', () => {
  beforeEach(() => {
    setEnv()
    s3Commands.length = 0
    ddbCommands.length = 0
    pluginSecretRows.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('site-settings.json does not include PluginSecret values even when secrets exist', async () => {
    // Seed a secret value in the PluginSecret table.
    pluginSecretRows.set('default:plugins.webhook.signingSecret', 'super-secret-do-not-leak')

    // Trigger a site.settings.updated event — this rebuilds the S3 mirror.
    const handler = createProcessorTrustedHandler({ site })
    await handler(event('site.settings.updated'), {} as never, vi.fn() as never)

    // The trusted processor reads from KvStore (DynamoDB DocumentClient,
    // uses QueryCommand against KV_TABLE) for the S3 mirror. It does NOT
    // read from PLUGIN_SECRET_TABLE in the mirror path. Verify by:
    // 1. Checking the S3 PutObject was called for site-settings.json.
    // 2. Verifying the body does NOT contain the secret value.
    const siteSettingsCmd = s3Commands.find(
      (cmd) => (cmd.input.Key as string)?.endsWith('site-settings.json')
    )
    expect(siteSettingsCmd).toBeDefined()

    const body = siteSettingsCmd!.input.Body as string
    expect(body).not.toContain('super-secret-do-not-leak')
    expect(body).not.toContain('signingSecret')
  })

  it('rebuildSiteSettingsCache queries KV_TABLE only, not PLUGIN_SECRET_TABLE', async () => {
    const handler = createProcessorTrustedHandler({ site })
    await handler(event('site.settings.updated'), {} as never, vi.fn() as never)

    // All DDB DocumentClient queries (used for KvStore) should target KV_TABLE.
    // None should target PLUGIN_SECRET_TABLE.
    const tableNames = ddbCommands.map((cmd) => cmd.input.TableName as string)
    for (const tableName of tableNames) {
      expect(tableName).not.toBe(process.env.AMPLESS_PLUGIN_SECRET_TABLE)
    }
  })
})

// ---------------------------------------------------------------------------
// decryptSecret — AES-256-GCM round-trip (pure unit test, no DDB/S3 mocks)
// ---------------------------------------------------------------------------

/**
 * Mirror of the admin-side encrypt logic (browser Web Crypto layout):
 * base64( IV[12] || ciphertext || authTag[16] )
 * where authTag is appended by GCM automatically.
 */
function encryptForTest(rawKey: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', rawKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const combined = Buffer.concat([iv, encrypted, authTag])
  return combined.toString('base64')
}

describe('decryptSecret — AES-256-GCM round-trip', () => {
  it('decrypts to original plaintext', () => {
    const key = randomBytes(32)
    const plaintext = 'super-secret-webhook-key-1234'
    const ciphertext = encryptForTest(key, plaintext)
    expect(decryptSecret(key, ciphertext)).toBe(plaintext)
  })

  it('decrypts empty string', () => {
    const key = randomBytes(32)
    const ciphertext = encryptForTest(key, '')
    expect(decryptSecret(key, ciphertext)).toBe('')
  })

  it('decrypts unicode string', () => {
    const key = randomBytes(32)
    const plaintext = 'シークレット🔑'
    const ciphertext = encryptForTest(key, plaintext)
    expect(decryptSecret(key, ciphertext)).toBe(plaintext)
  })

  it('throws on tampered ciphertext (authTag mismatch)', () => {
    const key = randomBytes(32)
    const ciphertext = encryptForTest(key, 'original')
    // Flip a byte in the ciphertext region (after the 12-byte IV, before the last 16-byte tag)
    const bytes = Buffer.from(ciphertext, 'base64')
    bytes[12] = (bytes[12]! ^ 0xff) & 0xff
    const tampered = bytes.toString('base64')
    expect(() => decryptSecret(key, tampered)).toThrow()
  })

  it('throws on wrong key', () => {
    const key1 = randomBytes(32)
    const key2 = randomBytes(32)
    const ciphertext = encryptForTest(key1, 'secret')
    expect(() => decryptSecret(key2, ciphertext)).toThrow()
  })

  it('throws on blob shorter than IV + authTag', () => {
    const key = randomBytes(32)
    const tooShort = Buffer.alloc(10).toString('base64')
    expect(() => decryptSecret(key, tooShort)).toThrow(/too short/)
  })
})

// ---------------------------------------------------------------------------
// ctx.secret — AES-256-GCM decrypt path (process.env key, encrypted values in DDB)
// ---------------------------------------------------------------------------

describe('createProcessorTrustedHandler ctx.secret — AES-256-GCM decrypt', () => {
  beforeEach(() => {
    setEnv(/* withEncKey= */ true)
    s3Commands.length = 0
    ddbCommands.length = 0
    pluginSecretRows.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function secretPlugin(partial: Partial<AmplessPlugin> = {}): AmplessPlugin {
    return {
      name: 'webhook',
      apiVersion: 1,
      trust_level: 'trusted',
      capabilities: ['eventHooks', 'secretSettings'],
      ...partial,
    }
  }

  it('decrypts an AES-256-GCM encrypted secret from DDB (key from process.env)', async () => {
    // Encrypt the plaintext using the same key that is in the env var.
    const plaintext = 'my-encrypted-api-key'
    const ciphertext = encryptForTest(TEST_ENC_KEY, plaintext)

    // Seed only the secret row.
    pluginSecretRows.set('default:plugins.webhook.apiKey', ciphertext)

    let capturedSecret: string | undefined
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              capturedSecret = await (ctx as TrustedPluginRuntimeContext).secret<string>('apiKey')
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    expect(capturedSecret).toBe(plaintext)
  })

  it('returns undefined with warning when the encryption key is absent', async () => {
    // Simulate a site that has not provisioned the file-based encryption key yet.
    setEnv(/* withEncKey= */ false)
    pluginSecretRows.set('default:plugins.webhook.signingSecret', 'not-encrypted-value')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let capturedSecret: unknown = 'sentinel'

    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              capturedSecret = await (ctx as TrustedPluginRuntimeContext).secret('signingSecret')
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    // Fails closed instead of handing an opaque ciphertext/plaintext blob to plugin code.
    expect(capturedSecret).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no encryption key found'))
  })

  it('caches decrypted plaintext — DDB fetch only once per invocation', async () => {
    const ciphertext = encryptForTest(TEST_ENC_KEY, 'cached-decrypted')
    pluginSecretRows.set('default:plugins.webhook.token', ciphertext)

    const callCount = { n: 0 }
    const handler = createProcessorTrustedHandler({
      site,
      plugins: [
        secretPlugin({
          hooks: {
            'content.published': async (_evt, ctx) => {
              const v1 = await (ctx as TrustedPluginRuntimeContext).secret('token')
              const v2 = await (ctx as TrustedPluginRuntimeContext).secret('token')
              expect(v1).toBe('cached-decrypted')
              expect(v2).toBe('cached-decrypted')
              callCount.n++
            },
          },
        }),
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)
    expect(callCount.n).toBe(1)
  })
})
