import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DynamoDBRecord } from 'aws-lambda'

// dispatcher.ts reads TRUSTED_QUEUE_URL / UNTRUSTED_QUEUE_URL via requireEnv
// at MODULE LOAD time and constructs the SQS + DDB clients eagerly, so these
// must be present before the dynamic import below. AMPLESS_POST_HISTORY_TABLE
// is read lazily per-invocation inside the handler, so individual tests can
// set/unset it.
process.env.TRUSTED_QUEUE_URL = 'https://sqs.test/trusted'
process.env.UNTRUSTED_QUEUE_URL = 'https://sqs.test/untrusted'

// Mock `ampless` — only the runtime value exports the dispatcher uses.
vi.mock('ampless', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>().catch(() => ({}))
  return {
    ...original,
    // The dispatcher's content-event detection is exercised by other suites;
    // here we stub it to a no-op so PostHistory logic is isolated. Returning
    // [] means emitContentEvents only contributes post.index.refresh (which
    // is fine — these tests assert on PostHistory puts, not SQS payloads).
    detectContentEvents: () => [],
  }
})

// --- AWS SDK mocks --------------------------------------------------------

const sqsCommands = vi.hoisted(() => [] as Array<{ input: Record<string, unknown> }>)
// PutCommand inputs captured from the DocumentClient. Each entry also records
// whether the mock "store" already had the postHistoryId (to simulate the
// ConditionExpression idempotency guard).
const ddbPuts = vi.hoisted(() => [] as Array<Record<string, unknown>>)
// Full PutCommand inputs (Item + ConditionExpression + TableName) for the
// successful puts, so tests can assert on the condition / table.
const ddbPutInputs = vi.hoisted(() => [] as Array<Record<string, unknown>>)
// Simulated PostHistory table keyed by postHistoryId, used to drive the
// attribute_not_exists(...) conditional check on re-delivery.
const historyStore = vi.hoisted(() => new Set<string>())
// When true the next DDB send rejects with a generic (non-conditional) error,
// to exercise the resilience (swallow + log, don't throw) path.
const ddbFailNext = vi.hoisted(() => ({ value: false }))

vi.mock('@aws-sdk/client-sqs', () => {
  class SendMessageBatchCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class SQSClient {
    async send(command: { input: Record<string, unknown> }) {
      sqsCommands.push(command)
      return {}
    }
  }
  return { SQSClient, SendMessageBatchCommand }
})

vi.mock('@aws-sdk/client-dynamodb', () => {
  class DynamoDBClient {}
  return { DynamoDBClient }
})

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class PutCommand {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class ConditionalCheckFailedException extends Error {
    constructor() {
      super('The conditional request failed')
      this.name = 'ConditionalCheckFailedException'
    }
  }
  const DynamoDBDocumentClient = {
    from() {
      return {
        async send(command: { input: Record<string, unknown> }) {
          if (ddbFailNext.value) {
            ddbFailNext.value = false
            throw new Error('simulated DDB failure')
          }
          const input = command.input
          const item = input.Item as Record<string, unknown>
          const id = item.postHistoryId as string
          // Honour the attribute_not_exists(postHistoryId) guard: if the row
          // already exists, throw the conditional exception just like DDB.
          if (
            input.ConditionExpression === 'attribute_not_exists(postHistoryId)' &&
            historyStore.has(id)
          ) {
            throw new ConditionalCheckFailedException()
          }
          historyStore.add(id)
          ddbPuts.push(item)
          ddbPutInputs.push(input)
          return {}
        },
      }
    },
  }
  return { DynamoDBDocumentClient, PutCommand, ConditionalCheckFailedException }
})

// Minimal marshall/unmarshall for the DDB AttributeValue images used below.
vi.mock('@aws-sdk/util-dynamodb', () => {
  function unmarshall(
    item: Record<string, Record<string, unknown>>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [k, descriptor] of Object.entries(item)) {
      if ('S' in descriptor) result[k] = descriptor['S']
      else if ('N' in descriptor) result[k] = Number(descriptor['N'])
      else if ('BOOL' in descriptor) result[k] = descriptor['BOOL']
      else if ('L' in descriptor) {
        result[k] = (descriptor['L'] as Array<Record<string, unknown>>).map((d) =>
          'S' in d ? d['S'] : 'N' in d ? Number(d['N']) : d
        )
      }
    }
    return result
  }
  return { unmarshall }
})

// Dynamic import AFTER mocks + env so module-load wiring picks them up.
const { createDispatcherHandler, handler } = await import('./dispatcher.js')

// --- Helpers --------------------------------------------------------------

const POST_TABLE_ARN =
  'arn:aws:dynamodb:us-east-1:123456789012:table/Post-abcdef-NONE/stream/2026-01-01T00:00:00.000'

interface PostImage {
  postId?: string
  slug?: string
  title?: string
  excerpt?: string
  format?: string
  body?: string
  status?: string
  publishedAt?: string
  tags?: string[]
  metadata?: string
  updatedAt?: string
}

function marshalImage(post: PostImage): Record<string, Record<string, unknown>> {
  const img: Record<string, Record<string, unknown>> = {}
  if (post.postId !== undefined) img.postId = { S: post.postId }
  if (post.slug !== undefined) img.slug = { S: post.slug }
  if (post.title !== undefined) img.title = { S: post.title }
  if (post.excerpt !== undefined) img.excerpt = { S: post.excerpt }
  if (post.format !== undefined) img.format = { S: post.format }
  if (post.body !== undefined) img.body = { S: post.body }
  if (post.status !== undefined) img.status = { S: post.status }
  if (post.publishedAt !== undefined) img.publishedAt = { S: post.publishedAt }
  if (post.tags !== undefined) img.tags = { L: post.tags.map((t) => ({ S: t })) }
  if (post.metadata !== undefined) img.metadata = { S: post.metadata }
  if (post.updatedAt !== undefined) img.updatedAt = { S: post.updatedAt }
  return img
}

function postRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newImage: PostImage | null,
  opts: { approxCreationSeconds?: number } = {}
): DynamoDBRecord {
  return {
    eventName,
    eventSourceARN: POST_TABLE_ARN,
    dynamodb: {
      ...(newImage ? { NewImage: marshalImage(newImage) as never } : {}),
      ...(opts.approxCreationSeconds !== undefined
        ? { ApproximateCreationDateTime: opts.approxCreationSeconds }
        : {}),
    },
  } as DynamoDBRecord
}

function streamEvent(records: DynamoDBRecord[]) {
  return { Records: records } as Parameters<DynamoDBStreamHandlerInput>[0]
}
type DynamoDBStreamHandlerInput = (event: { Records: DynamoDBRecord[] }) => Promise<void>

const SAMPLE_POST: PostImage = {
  postId: 'post-001',
  slug: 'hello-world',
  title: 'Hello World',
  excerpt: 'an excerpt',
  format: 'markdown',
  body: '"# Hello"',
  status: 'published',
  publishedAt: '2026-06-01T00:00:00.000Z',
  tags: ['tech', 'news'],
  metadata: '{"cache":"auto"}',
  updatedAt: '2026-06-05T12:00:00.000Z',
}

beforeEach(() => {
  sqsCommands.length = 0
  ddbPuts.length = 0
  ddbPutInputs.length = 0
  historyStore.clear()
  ddbFailNext.value = false
  process.env.AMPLESS_POST_HISTORY_TABLE = 'PostHistory-test'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.AMPLESS_POST_HISTORY_TABLE
})

// --- Tests ----------------------------------------------------------------

describe('createDispatcherHandler — PostHistory capture', () => {
  it('writes a PostHistory snapshot for an INSERT with createdAt/updatedAt and the deterministic id', async () => {
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    await h(streamEvent([postRecord('INSERT', SAMPLE_POST)]), {} as never, vi.fn() as never)

    expect(ddbPuts).toHaveLength(1)
    const item = ddbPuts[0]!
    expect(item.postHistoryId).toBe('post-001#2026-06-05T12:00:00.000Z')
    expect(item.postId).toBe('post-001')
    expect(item.revisedAt).toBe('2026-06-05T12:00:00.000Z')
    // createdAt / updatedAt must equal revisedAt — without them the AppSync
    // read resolver returns null for the whole row (Phase 6a bug).
    expect(item.createdAt).toBe('2026-06-05T12:00:00.000Z')
    expect(item.updatedAt).toBe('2026-06-05T12:00:00.000Z')
    // Heavy fields copied verbatim.
    expect(item.title).toBe('Hello World')
    expect(item.slug).toBe('hello-world')
    expect(item.excerpt).toBe('an excerpt')
    expect(item.format).toBe('markdown')
    expect(item.body).toBe('"# Hello"')
    expect(item.status).toBe('published')
    expect(item.tags).toEqual(['tech', 'news'])
    expect(item.metadata).toBe('{"cache":"auto"}')
    // retentionDays 0 → no ttl attribute.
    expect('ttl' in item).toBe(false)
  })

  it('snapshots a minimal draft (undefined excerpt/publishedAt/metadata) without error', async () => {
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    const draft: PostImage = {
      postId: 'post-002',
      slug: 'draft-post',
      title: 'Draft',
      status: 'draft',
      updatedAt: '2026-06-05T13:00:00.000Z',
      // excerpt / publishedAt / metadata / tags / format / body all omitted —
      // the DocumentClient is configured with removeUndefinedValues so these
      // would otherwise throw "Unsupported type passed: undefined".
    }
    await expect(
      h(streamEvent([postRecord('INSERT', draft)]), {} as never, vi.fn() as never)
    ).resolves.toBeUndefined()
    expect(ddbPuts).toHaveLength(1)
    const item = ddbPuts[0]!
    expect(item.postHistoryId).toBe('post-002#2026-06-05T13:00:00.000Z')
    expect(item.title).toBe('Draft')
    expect(item.createdAt).toBe('2026-06-05T13:00:00.000Z')
    expect(item.updatedAt).toBe('2026-06-05T13:00:00.000Z')
  })

  it('writes a snapshot for a MODIFY as well', async () => {
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    await h(streamEvent([postRecord('MODIFY', SAMPLE_POST)]), {} as never, vi.fn() as never)
    expect(ddbPuts).toHaveLength(1)
    expect(ddbPuts[0]!.postHistoryId).toBe('post-001#2026-06-05T12:00:00.000Z')
  })

  it('does NOT write a snapshot for a REMOVE', async () => {
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    await h(streamEvent([postRecord('REMOVE', null)]), {} as never, vi.fn() as never)
    expect(ddbPuts).toHaveLength(0)
  })

  it('falls back to ApproximateCreationDateTime (ISO) when updatedAt is absent', async () => {
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    const { updatedAt: _omit, ...noUpdatedAt } = SAMPLE_POST
    // 2026-06-05T12:00:00.000Z = 1780747200 seconds.
    await h(
      streamEvent([postRecord('INSERT', noUpdatedAt, { approxCreationSeconds: 1780747200 })]),
      {} as never,
      vi.fn() as never
    )
    expect(ddbPuts).toHaveLength(1)
    const item = ddbPuts[0]!
    expect(item.revisedAt).toBe(new Date(1780747200 * 1000).toISOString())
    expect(item.postHistoryId).toBe(`post-001#${new Date(1780747200 * 1000).toISOString()}`)
  })

  describe('ttl logic', () => {
    it('omits ttl when retentionDays is 0', async () => {
      const h = createDispatcherHandler({ historyRetentionDays: 0 })
      await h(streamEvent([postRecord('INSERT', SAMPLE_POST)]), {} as never, vi.fn() as never)
      expect('ttl' in ddbPuts[0]!).toBe(false)
    })

    it('computes ttl from revisedAt (not now) when retentionDays is 365', async () => {
      const h = createDispatcherHandler({ historyRetentionDays: 365 })
      await h(streamEvent([postRecord('INSERT', SAMPLE_POST)]), {} as never, vi.fn() as never)
      const expected =
        Math.floor(new Date(SAMPLE_POST.updatedAt!).getTime() / 1000) + 365 * 86400
      expect(ddbPuts[0]!.ttl).toBe(expected)
    })
  })

  describe('idempotency', () => {
    it('sets the attribute_not_exists ConditionExpression and target table on the put', async () => {
      const h = createDispatcherHandler({ historyRetentionDays: 0 })
      await h(streamEvent([postRecord('INSERT', SAMPLE_POST)]), {} as never, vi.fn() as never)
      expect(ddbPutInputs).toHaveLength(1)
      expect(ddbPutInputs[0]!.ConditionExpression).toBe('attribute_not_exists(postHistoryId)')
      expect(ddbPutInputs[0]!.TableName).toBe('PostHistory-test')
    })

    it('re-delivery of the same save does not overwrite (conditional check no-op)', async () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const h = createDispatcherHandler({ historyRetentionDays: 0 })
      const rec = postRecord('INSERT', SAMPLE_POST)
      await h(streamEvent([rec]), {} as never, vi.fn() as never)
      await h(streamEvent([rec]), {} as never, vi.fn() as never)
      // Only the first put landed; the second hit the conditional guard.
      expect(ddbPuts).toHaveLength(1)
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('already exists'))
    })
  })

  it('a history-write failure is logged and does NOT throw out of the handler', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ddbFailNext.value = true
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    // Should resolve, not reject, despite the simulated DDB error.
    await expect(
      h(streamEvent([postRecord('INSERT', SAMPLE_POST)]), {} as never, vi.fn() as never)
    ).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('snapshot write failed'),
      expect.anything()
    )
    expect(ddbPuts).toHaveLength(0)
  })

  it('skips history writes (and logs once) when AMPLESS_POST_HISTORY_TABLE is unset', async () => {
    delete process.env.AMPLESS_POST_HISTORY_TABLE
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const h = createDispatcherHandler({ historyRetentionDays: 0 })
    await h(
      streamEvent([postRecord('INSERT', SAMPLE_POST), postRecord('MODIFY', SAMPLE_POST)]),
      {} as never,
      vi.fn() as never
    )
    expect(ddbPuts).toHaveLength(0)
    const tableWarns = (log.mock.calls as Array<[string]>).filter(([m]) =>
      m?.includes('AMPLESS_POST_HISTORY_TABLE not set')
    )
    expect(tableWarns).toHaveLength(1)
  })
})

describe('default handler export', () => {
  it('is a callable handler with retentionDays 0 (no ttl)', async () => {
    await handler(streamEvent([postRecord('INSERT', SAMPLE_POST)]), {} as never, vi.fn() as never)
    expect(ddbPuts).toHaveLength(1)
    expect('ttl' in ddbPuts[0]!).toBe(false)
  })
})
