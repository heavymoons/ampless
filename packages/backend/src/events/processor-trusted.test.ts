import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AmplessPlugin, Config } from 'ampless'
import { createProcessorTrustedHandler } from './processor-trusted.js'

const s3Commands = vi.hoisted(() => [] as Array<{ input: Record<string, unknown> }>)
const ddbCommands = vi.hoisted(() => [] as Array<{ input: Record<string, unknown> }>)

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
  class DynamoDBClient {}
  return { DynamoDBClient }
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

function setEnv(): void {
  process.env.AMPLESS_BUCKET_NAME = 'test-bucket'
  process.env.AMPLESS_POST_TABLE = 'posts'
  process.env.AMPLESS_KV_TABLE = 'kv'
  process.env.AMPLESS_POSTTAG_TABLE = 'posttags'
  process.env.AWS_REGION = 'us-east-1'
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
})
