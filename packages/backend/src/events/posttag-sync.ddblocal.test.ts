import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { ContentEventPayload } from 'ampless'
import { candidateKeys, reconcilePostTagsForPost, type PostTagSyncClient } from './posttag-sync.js'

// Integration test of the guarded PostTag rebuild against DynamoDB Local, so
// the guard's condition is evaluated by a real DynamoDB engine (list
// equality, attribute_not_exists, transaction cancellation) rather than by
// the test fake. Opt-in: set AMPLESS_DYNAMODB_LOCAL_ENDPOINT, e.g.
//
//   docker run --rm -p 18000:8000 amazon/dynamodb-local
//   AMPLESS_DYNAMODB_LOCAL_ENDPOINT=http://localhost:18000 pnpm vitest run posttag-sync.ddblocal
//
// Skipped otherwise (CI has no DynamoDB Local). Never point it at AWS: it
// creates and deletes tables.

const endpoint = process.env.AMPLESS_DYNAMODB_LOCAL_ENDPOINT

describe.skipIf(!endpoint)('reconcilePostTagsForPost on DynamoDB Local', () => {
  const run = randomUUID().slice(0, 8)
  const postTable = `Post-ddblocal-${run}`
  const postTagTable = `PostTag-ddblocal-${run}`
  let raw: DynamoDBClient
  let ddb: DynamoDBDocumentClient

  beforeAll(async () => {
    if (!endpoint || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint)) {
      throw new Error(`AMPLESS_DYNAMODB_LOCAL_ENDPOINT must be a local http URL (got ${endpoint})`)
    }
    raw = new DynamoDBClient({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    })
    ddb = DynamoDBDocumentClient.from(raw)
    await raw.send(
      new CreateTableCommand({
        TableName: postTable,
        AttributeDefinitions: [{ AttributeName: 'postId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'postId', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      })
    )
    await raw.send(
      new CreateTableCommand({
        TableName: postTagTable,
        AttributeDefinitions: [
          { AttributeName: 'tag', AttributeType: 'S' },
          { AttributeName: 'publishedAtPostId', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'tag', KeyType: 'HASH' },
          { AttributeName: 'publishedAtPostId', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      })
    )
  })

  afterAll(async () => {
    if (!raw) return
    for (const TableName of [postTable, postTagTable]) {
      await raw.send(new DeleteTableCommand({ TableName })).catch(() => {})
    }
  })

  let seq = 0
  const newPostId = () => `p-${run}-${++seq}`

  const publishedItem = (
    postId: string,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> & { title: string; excerpt?: unknown } => ({
    postId,
    slug: `slug-${postId}`,
    title: `Title ${postId}`,
    status: 'published',
    format: 'markdown',
    publishedAt: '2026-05-01T09:00:00+09:00',
    tags: ['a', 'b'],
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  })

  const projection = (item: Record<string, unknown>): ContentEventPayload =>
    ({
      postId: item.postId,
      slug: item.slug,
      title: item.title,
      status: item.status,
      format: item.format,
      excerpt: item.excerpt,
      publishedAt: item.publishedAt,
      tags: item.tags,
    }) as ContentEventPayload

  async function rowsOf(postId: string) {
    const res = await ddb.send(new ScanCommand({ TableName: postTagTable, ConsistentRead: true }))
    return (res.Items ?? []).filter((r) => r.postId === postId)
  }

  async function unpublish(postId: string) {
    await ddb.send(
      new UpdateCommand({
        TableName: postTable,
        Key: { postId },
        UpdateExpression: 'SET #s = :d, #u = :u',
        ExpressionAttributeNames: { '#s': 'status', '#u': 'updatedAt' },
        ExpressionAttributeValues: { ':d': 'draft', ':u': new Date().toISOString() },
      })
    )
  }

  const txKind = (command: TransactWriteCommand) =>
    command.input.TransactItems?.[1]?.Delete ? 'delete' : 'put'

  /**
   * Real client with hooks around each guarded write of one kind (default:
   * guarded Puts; 1-based index). Other calls pass straight through.
   */
  function hooked(
    beforeTx: (n: number) => Promise<void>,
    afterTx: (n: number) => Promise<void> = async () => {},
    kind: 'put' | 'delete' = 'put'
  ): PostTagSyncClient {
    let n = 0
    return {
      async send(command) {
        if (command instanceof TransactWriteCommand && txKind(command) === kind) {
          n++
          await beforeTx(n)
          const res = await ddb.send(command as never)
          await afterTx(n)
          return res
        }
        return ddb.send(command as never)
      },
    }
  }

  async function republish(item: Record<string, unknown>) {
    await ddb.send(
      new PutCommand({
        TableName: postTable,
        Item: { ...item, updatedAt: new Date(Date.now() + 1).toISOString() },
      })
    )
  }

  const reconcile = (
    client: PostTagSyncClient,
    postId: string,
    payload?: Parameters<typeof candidateKeys>[0]
  ) =>
    reconcilePostTagsForPost({
      client,
      postTable,
      postTagTable,
      postId,
      candidates: candidateKeys(payload ?? null),
      log: () => {},
    })

  it('a published post gets one canonical row per tag', async () => {
    const postId = newPostId()
    const item = publishedItem(postId)
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    await reconcile(ddb, postId, { previous: null, next: projection(item) })
    const rows = await rowsOf(postId)
    expect(rows.map((r) => r.publishedAtPostId).sort()).toEqual([
      `2026-05-01T00:00:00.000Z#${postId}`,
      `2026-05-01T00:00:00.000Z#${postId}`,
    ])
    expect(rows.map((r) => r.tag).sort()).toEqual(['a', 'b'])
  })

  it('(a) unpublished between the read and the first Put: the real guard rejects it, zero rows', async () => {
    const postId = newPostId()
    const item = publishedItem(postId, { excerpt: 'secret draft excerpt' })
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    const client = hooked(async (n) => {
      if (n === 1) await unpublish(postId)
    })
    const result = await reconcile(client, postId, { previous: null, next: projection(item) })
    expect(result.guardFailures).toBe(1)
    expect(result.puts).toBe(0)
    expect(await rowsOf(postId)).toEqual([])
  })

  it('(a) unpublished between two Puts: the second is rejected and the first row is removed', async () => {
    const postId = newPostId()
    const item = publishedItem(postId)
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    const client = hooked(async (n) => {
      if (n === 2) await unpublish(postId)
    })
    const result = await reconcile(client, postId, { previous: null, next: projection(item) })
    expect(result.puts).toBe(1)
    expect(result.guardFailures).toBe(1)
    expect(await rowsOf(postId)).toEqual([])
  })

  it('the guard compares the tags list exactly (reordered tags fail it) and converges on the new state', async () => {
    const postId = newPostId()
    const item = publishedItem(postId)
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    const client = hooked(async (n) => {
      if (n === 1) {
        await ddb.send(
          new UpdateCommand({
            TableName: postTable,
            Key: { postId },
            UpdateExpression: 'SET tags = :t',
            ExpressionAttributeValues: { ':t': ['b', 'a'] },
          })
        )
      }
    })
    const result = await reconcile(client, postId, { previous: null, next: projection(item) })
    expect(result.guardFailures).toBe(1)
    const rows = await rowsOf(postId)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.tags).toEqual(['b', 'a'])
  })

  it('the guard sees an attribute appear (absent excerpt → excerpt set) and writes the new content', async () => {
    const postId = newPostId()
    const item = publishedItem(postId)
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    const client = hooked(async (n) => {
      if (n === 1) {
        await ddb.send(
          new UpdateCommand({
            TableName: postTable,
            Key: { postId },
            UpdateExpression: 'SET excerpt = :e',
            ExpressionAttributeValues: { ':e': 'added' },
          })
        )
      }
    })
    const result = await reconcile(client, postId, { previous: null, next: projection(item) })
    expect(result.guardFailures).toBe(1)
    const rows = await rowsOf(postId)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.excerpt).toBe('added')
  })

  for (const order of ['retry first', 'draft refresh first'] as const) {
    it(`(b) crash after a committed Put, then unpublish; ${order} → zero rows`, async () => {
      const postId = newPostId()
      const item = publishedItem(postId, { excerpt: 'soon a draft' })
      await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
      const crashing = hooked(
        async () => {},
        async (n) => {
          if (n === 1) throw new Error('simulated crash after the first committed Put')
        }
      )
      const refresh = { previous: null, next: projection(item) }
      await expect(reconcile(crashing, postId, refresh)).rejects.toThrow('simulated crash')
      expect(await rowsOf(postId)).toHaveLength(1) // committed while it was published

      await unpublish(postId)
      const draftRefresh = {
        previous: projection(item),
        next: projection({ ...item, status: 'draft' }),
      }
      const runs = [
        () => reconcile(ddb, postId, refresh),
        () => reconcile(ddb, postId, draftRefresh),
      ]
      if (order === 'draft refresh first') runs.reverse()
      for (const r of runs) await r()
      expect(await rowsOf(postId)).toEqual([])
    })
  }

  it('B then A (the #413 review case): migration refresh processed after the unpublish leaves no row', async () => {
    const postId = newPostId()
    const legacy = publishedItem(postId, { excerpt: 'draft-to-be' })
    await ddb.send(new PutCommand({ TableName: postTable, Item: legacy }))
    // Old verbatim-keyed rows written by an earlier release.
    for (const tag of ['a', 'b']) {
      await ddb.send(
        new PutCommand({
          TableName: postTagTable,
          Item: {
            tag,
            publishedAtPostId: `2026-05-01T09:00:00+09:00#${postId}`,
            postId,
            title: legacy.title,
            excerpt: legacy.excerpt,
          },
        })
      )
    }
    const canonical = { ...legacy, publishedAt: '2026-05-01T00:00:00.000Z' }
    // A: migration write (stream event emitted). B: unpublish.
    await ddb.send(new PutCommand({ TableName: postTable, Item: canonical }))
    await unpublish(postId)
    const eventA = { previous: projection(legacy), next: projection(canonical) }
    const eventB = {
      previous: projection(canonical),
      next: projection({ ...canonical, status: 'draft' }),
    }
    await reconcile(ddb, postId, eventB)
    await reconcile(ddb, postId, eventA)
    expect(await rowsOf(postId)).toEqual([])
  })
  it("B writes before A deletes: the real guard refuses A's stale delete, the current row stays", async () => {
    const postId = newPostId()
    const item = publishedItem(postId, { tags: ['a'] })
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    await reconcile(ddb, postId, { previous: null, next: projection(item) })
    await unpublish(postId)
    const draftEvent = {
      previous: projection(item),
      next: projection({ ...item, status: 'draft' }),
    }
    // A reads the draft; before its first delete commits, the post is
    // republished and B indexes it.
    const a = hooked(
      async (n) => {
        if (n === 1) {
          await republish(item)
          await reconcile(ddb, postId, { previous: draftEvent.next, next: projection(item) })
          expect(await rowsOf(postId)).toHaveLength(1)
        }
      },
      undefined,
      'delete'
    )
    const result = await reconcile(a, postId, draftEvent)
    expect(result.guardFailures).toBe(1)
    expect(await rowsOf(postId)).toHaveLength(1)
  })

  it('B writes before A deletes, then A crashes right after its refused delete: the current row stays', async () => {
    const postId = newPostId()
    const item = publishedItem(postId, { tags: ['a'] })
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    await reconcile(ddb, postId, { previous: null, next: projection(item) })
    await unpublish(postId)
    const draftEvent = {
      previous: projection(item),
      next: projection({ ...item, status: 'draft' }),
    }
    let refused = false
    const crashingA: PostTagSyncClient = {
      async send(command) {
        if (refused) throw new Error('simulated crash after the refused delete')
        if (command instanceof TransactWriteCommand && txKind(command) === 'delete') {
          await republish(item)
          await reconcile(ddb, postId, { previous: draftEvent.next, next: projection(item) })
          try {
            return await ddb.send(command as never)
          } catch (err) {
            refused = true
            throw err
          }
        }
        return ddb.send(command as never)
      },
    }
    await expect(reconcile(crashingA, postId, draftEvent)).rejects.toThrow('simulated crash')
    expect(refused).toBe(true)
    expect(await rowsOf(postId)).toHaveLength(1)
    // SQS retry of A's message.
    await reconcile(ddb, postId, draftEvent)
    expect(await rowsOf(postId)).toHaveLength(1)
  })

  it('a deleted post\'s rows are removed under the "item does not exist" guard; a re-created post keeps its rows', async () => {
    const postId = newPostId()
    const item = publishedItem(postId, { tags: ['a'] })
    await ddb.send(new PutCommand({ TableName: postTable, Item: item }))
    await reconcile(ddb, postId, { previous: null, next: projection(item) })
    await ddb.send(new DeleteCommand({ TableName: postTable, Key: { postId } }))
    const removeEvent = { previous: projection(item), next: null }
    // Re-created before the delete commits: the guard refuses it.
    const a = hooked(
      async (n) => {
        if (n === 1) {
          await republish(item)
          await reconcile(ddb, postId, { previous: null, next: projection(item) })
        }
      },
      undefined,
      'delete'
    )
    await reconcile(a, postId, removeEvent)
    expect(await rowsOf(postId)).toHaveLength(1)
    // Deleted for good: the guarded delete goes through.
    await ddb.send(new DeleteCommand({ TableName: postTable, Key: { postId } }))
    await reconcile(ddb, postId, removeEvent)
    expect(await rowsOf(postId)).toEqual([])
  })

  it('leaves unrelated rows alone (another post under the same tag)', async () => {
    const mine = newPostId()
    const other = newPostId()
    const mineItem = publishedItem(mine, { tags: ['shared'] })
    const otherItem = publishedItem(other, { tags: ['shared'] })
    for (const it of [mineItem, otherItem]) {
      await ddb.send(new PutCommand({ TableName: postTable, Item: it }))
      await reconcile(ddb, it.postId as string, { previous: null, next: projection(it) })
    }
    await unpublish(mine)
    await reconcile(ddb, mine, {
      previous: projection(mineItem),
      next: projection({ ...mineItem, status: 'draft' }),
    })
    expect(await rowsOf(mine)).toEqual([])
    expect(await rowsOf(other)).toHaveLength(1)
  })
})
