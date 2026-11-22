import { describe, expect, it, vi } from 'vitest'
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  planPublishedAtMigration,
  runPublishedAtMigration,
  type MigrationClient,
} from './published-at.js'

// --- Fake DocumentClient ----------------------------------------------------
//
// An in-memory Post table that answers ScanCommand (paged by `Limit`, with
// LastEvaluatedKey) and applies the migration's UpdateCommands while honouring
// their ConditionExpression. No AWS SDK client is ever constructed, so nothing
// leaves the process.

type Row = Record<string, unknown>

class ConditionalCheckFailedException extends Error {
  constructor() {
    super('The conditional request failed')
    this.name = 'ConditionalCheckFailedException'
  }
}

function fakeTable(rows: Row[]) {
  const table = new Map<string, Row>(rows.map((r) => [r.postId as string, { ...r }]))
  const scans: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  // Called before an update is applied; may mutate the table (to simulate a
  // concurrent edit) or throw.
  let beforeUpdate: ((input: Record<string, unknown>) => void) | undefined

  function conditionHolds(row: Row | undefined, input: Record<string, unknown>): boolean {
    if (!row) return false
    const values = input.ExpressionAttributeValues as Record<string, unknown>
    const cond = input.ConditionExpression as string
    const checks: boolean[] = []
    if (cond.includes('#pa = :raw')) checks.push(row.publishedAt === values[':raw'])
    if (cond.includes('attribute_not_exists(#pa)')) checks.push(!('publishedAt' in row))
    if (cond.includes('attribute_type(#pa, :nullType)')) checks.push(row.publishedAt === null)
    if (cond.includes('attribute_not_exists(#sk)')) checks.push(!('publishedAtSortKey' in row))
    if (cond.includes('#sk = :oldSortKey')) {
      checks.push(row.publishedAtSortKey === values[':oldSortKey'])
    }
    return checks.length > 0 && checks.every(Boolean)
  }

  const client: MigrationClient = {
    async send(command) {
      if (command instanceof ScanCommand) {
        const input = command.input as Record<string, unknown>
        scans.push(input)
        const all = [...table.values()].sort((a, b) =>
          String(a.postId).localeCompare(String(b.postId))
        )
        const start = input.ExclusiveStartKey
          ? all.findIndex(
              (r) => r.postId === (input.ExclusiveStartKey as { postId: string }).postId
            ) + 1
          : 0
        const limit = (input.Limit as number | undefined) ?? all.length
        const page = all.slice(start, start + limit)
        const more = start + limit < all.length
        return {
          Items: page.map((r) => {
            const projected: Row = { postId: r.postId }
            for (const k of ['publishedAt', 'publishedAtSortKey', 'status']) {
              if (k in r) projected[k] = r[k]
            }
            return projected
          }),
          ...(more ? { LastEvaluatedKey: { postId: page[page.length - 1]!.postId } } : {}),
        }
      }
      if (command instanceof UpdateCommand) {
        const input = command.input as Record<string, unknown>
        updates.push(input)
        beforeUpdate?.(input)
        const postId = (input.Key as { postId: string }).postId
        const row = table.get(postId)
        if (!conditionHolds(row, input)) throw new ConditionalCheckFailedException()
        const values = input.ExpressionAttributeValues as Record<string, unknown>
        if (input.UpdateExpression === 'SET #pa = :canonical, #sk = :sortKey') {
          row!.publishedAt = values[':canonical']
          row!.publishedAtSortKey = values[':sortKey']
        } else if (input.UpdateExpression === 'REMOVE #sk') {
          delete row!.publishedAtSortKey
        } else {
          throw new Error(`unexpected UpdateExpression ${String(input.UpdateExpression)}`)
        }
        return {}
      }
      throw new Error('unexpected command')
    },
  }

  return {
    client,
    table,
    scans,
    updates,
    onBeforeUpdate(fn: (input: Record<string, unknown>) => void) {
      beforeUpdate = fn
    },
  }
}

const TABLE = 'Post-abc-NONE'
const UPDATED_AT = '2026-06-05T12:00:00.000Z'

function sampleRows(): Row[] {
  return [
    // +09:00 legacy value, no sortKey.
    {
      postId: 'p1',
      status: 'published',
      publishedAt: '2026-05-01T09:00:00+09:00',
      updatedAt: UPDATED_AT,
    },
    // Already migrated.
    {
      postId: 'p2',
      status: 'published',
      publishedAt: '2026-05-02T00:00:00.000Z',
      publishedAtSortKey: '2026-05-02T00:00:00.000Z#p2',
      updatedAt: UPDATED_AT,
    },
    // Canonical value, sortKey missing.
    {
      postId: 'p3',
      status: 'draft',
      publishedAt: '2026-05-03T00:00:00.000Z',
      updatedAt: UPDATED_AT,
    },
    // Draft without publishedAt — nothing to do.
    { postId: 'p4', status: 'draft', updatedAt: UPDATED_AT },
    // Stray sortKey with publishedAt absent.
    { postId: 'p5', status: 'draft', publishedAtSortKey: 'stale#p5', updatedAt: UPDATED_AT },
    // Lowercase z → unparseable.
    {
      postId: 'p6',
      status: 'published',
      publishedAt: '2026-05-06T00:00:00z',
      updatedAt: UPDATED_AT,
    },
  ]
}

const noSleep = () => Promise.resolve()
const silent = () => {}

describe('planPublishedAtMigration', () => {
  it.each([
    [
      'canonical + correct sortKey → ok',
      {
        postId: 'a',
        publishedAt: '2026-01-01T00:00:00.000Z',
        publishedAtSortKey: '2026-01-01T00:00:00.000Z#a',
      },
      { kind: 'ok' },
    ],
    ['no publishedAt, no sortKey → ok', { postId: 'a' }, { kind: 'ok' }],
    ['publishedAt null, no sortKey → ok', { postId: 'a', publishedAt: null }, { kind: 'ok' }],
    [
      'offset form → rewrite (no old sortKey)',
      { postId: 'a', publishedAt: '2026-01-01T09:00:00+09:00' },
      {
        kind: 'rewrite',
        raw: '2026-01-01T09:00:00+09:00',
        canonical: '2026-01-01T00:00:00.000Z',
        sortKey: '2026-01-01T00:00:00.000Z#a',
        hadSortKey: false,
      },
    ],
    [
      'seconds-less Z form → rewrite',
      { postId: 'a', publishedAt: '2026-01-01T00:00Z' },
      {
        kind: 'rewrite',
        raw: '2026-01-01T00:00Z',
        canonical: '2026-01-01T00:00:00.000Z',
        sortKey: '2026-01-01T00:00:00.000Z#a',
        hadSortKey: false,
      },
    ],
    [
      'canonical but wrong sortKey → rewrite carrying the old sortKey',
      { postId: 'a', publishedAt: '2026-01-01T00:00:00.000Z', publishedAtSortKey: 'wrong#a' },
      {
        kind: 'rewrite',
        raw: '2026-01-01T00:00:00.000Z',
        canonical: '2026-01-01T00:00:00.000Z',
        sortKey: '2026-01-01T00:00:00.000Z#a',
        hadSortKey: true,
        oldSortKey: 'wrong#a',
      },
    ],
    [
      'absent publishedAt + sortKey → removeSortKey',
      { postId: 'a', publishedAtSortKey: 'x#a' },
      { kind: 'removeSortKey', publishedAt: 'absent', oldSortKey: 'x#a' },
    ],
    [
      'null publishedAt + sortKey → removeSortKey',
      { postId: 'a', publishedAt: null, publishedAtSortKey: 'x#a' },
      { kind: 'removeSortKey', publishedAt: 'null', oldSortKey: 'x#a' },
    ],
    [
      'lowercase z → unparseable',
      { postId: 'a', publishedAt: '2026-01-01T00:00:00z' },
      { kind: 'unparseable', raw: '2026-01-01T00:00:00z' },
    ],
    [
      'impossible date → unparseable',
      { postId: 'a', publishedAt: '2026-02-30T00:00:00Z' },
      { kind: 'unparseable', raw: '2026-02-30T00:00:00Z' },
    ],
    [
      'instant before UTC year 0000 → unparseable',
      { postId: 'a', publishedAt: '0000-01-01T00:00:00+01:00' },
      { kind: 'unparseable', raw: '0000-01-01T00:00:00+01:00' },
    ],
    [
      'empty string → unparseable',
      { postId: 'a', publishedAt: '' },
      { kind: 'unparseable', raw: '' },
    ],
    [
      'non-string → unparseable',
      { postId: 'a', publishedAt: 123 },
      { kind: 'unparseable', raw: 123 },
    ],
  ])('%s', (_label, item, expected) => {
    expect(planPublishedAtMigration(item)).toEqual(expected)
  })
})

describe('runPublishedAtMigration', () => {
  it('dry-run issues zero writes and reports the planned changes', async () => {
    const t = fakeTable(sampleRows())
    const lines: string[] = []
    const summary = await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      log: (l) => lines.push(l),
      sleep: noSleep,
    })
    expect(t.updates).toHaveLength(0)
    expect(summary).toMatchObject({
      apply: false,
      scanned: 6,
      ok: 2,
      toRewrite: 2,
      toRemoveSortKey: 1,
      rewritten: 0,
      sortKeyRemoved: 0,
      conflicts: [],
      failed: [],
    })
    expect(summary.unparseable).toEqual([
      { postId: 'p6', status: 'published', raw: '2026-05-06T00:00:00z' },
    ])
    const p1 = lines.find((l) => l.includes('postId=p1'))!
    expect(p1).toContain('WOULD REWRITE')
    expect(p1).toContain('status=published')
    expect(p1).toContain('raw=2026-05-01T09:00:00+09:00')
    expect(p1).toContain('canonical=2026-05-01T00:00:00.000Z')
    expect(p1).toContain('rawInstant=2026-05-01T00:00:00.000Z')
  })

  it('scans with the narrow projection (status via an attribute name)', async () => {
    const t = fakeTable(sampleRows())
    await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      log: silent,
      sleep: noSleep,
    })
    expect(t.scans[0]).toMatchObject({
      TableName: TABLE,
      ProjectionExpression: '#id, #pa, #sk, #st',
      ExpressionAttributeNames: {
        '#id': 'postId',
        '#pa': 'publishedAt',
        '#sk': 'publishedAtSortKey',
        '#st': 'status',
      },
    })
  })

  it('apply issues the exact conditional UpdateCommands and never touches updatedAt', async () => {
    const rows = [
      ...sampleRows(),
      // Canonical but wrong sortKey (exercises the sortKey-unchanged branch).
      {
        postId: 'p7',
        status: 'published',
        publishedAt: '2026-05-07T00:00:00.000Z',
        publishedAtSortKey: 'wrong#p7',
        updatedAt: UPDATED_AT,
      },
      // NULL publishedAt with a stray sortKey.
      {
        postId: 'p8',
        status: 'draft',
        publishedAt: null,
        publishedAtSortKey: 'x#p8',
        updatedAt: UPDATED_AT,
      },
    ]
    const t = fakeTable(rows)
    const summary = await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      apply: true,
      log: silent,
      sleep: noSleep,
    })

    const names = { '#pa': 'publishedAt', '#sk': 'publishedAtSortKey' }
    expect(t.updates).toEqual([
      {
        TableName: TABLE,
        Key: { postId: 'p1' },
        UpdateExpression: 'SET #pa = :canonical, #sk = :sortKey',
        ConditionExpression: '#pa = :raw AND attribute_not_exists(#sk)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: {
          ':canonical': '2026-05-01T00:00:00.000Z',
          ':sortKey': '2026-05-01T00:00:00.000Z#p1',
          ':raw': '2026-05-01T09:00:00+09:00',
        },
      },
      {
        TableName: TABLE,
        Key: { postId: 'p3' },
        UpdateExpression: 'SET #pa = :canonical, #sk = :sortKey',
        ConditionExpression: '#pa = :raw AND attribute_not_exists(#sk)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: {
          ':canonical': '2026-05-03T00:00:00.000Z',
          ':sortKey': '2026-05-03T00:00:00.000Z#p3',
          ':raw': '2026-05-03T00:00:00.000Z',
        },
      },
      {
        TableName: TABLE,
        Key: { postId: 'p5' },
        UpdateExpression: 'REMOVE #sk',
        ConditionExpression: 'attribute_not_exists(#pa) AND #sk = :oldSortKey',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ':oldSortKey': 'stale#p5' },
      },
      {
        TableName: TABLE,
        Key: { postId: 'p7' },
        UpdateExpression: 'SET #pa = :canonical, #sk = :sortKey',
        ConditionExpression: '#pa = :raw AND #sk = :oldSortKey',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: {
          ':canonical': '2026-05-07T00:00:00.000Z',
          ':sortKey': '2026-05-07T00:00:00.000Z#p7',
          ':raw': '2026-05-07T00:00:00.000Z',
          ':oldSortKey': 'wrong#p7',
        },
      },
      {
        TableName: TABLE,
        Key: { postId: 'p8' },
        UpdateExpression: 'REMOVE #sk',
        ConditionExpression: 'attribute_type(#pa, :nullType) AND #sk = :oldSortKey',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ':oldSortKey': 'x#p8', ':nullType': 'NULL' },
      },
    ])
    // updatedAt never appears in any expression or value.
    expect(JSON.stringify(t.updates)).not.toContain('updatedAt')
    for (const row of t.table.values()) expect(row.updatedAt).toBe(UPDATED_AT)
    // Unparseable p6 is never written and keeps its raw value.
    expect(t.updates.some((u) => (u.Key as { postId: string }).postId === 'p6')).toBe(false)
    expect(t.table.get('p6')!.publishedAt).toBe('2026-05-06T00:00:00z')

    expect(summary).toMatchObject({
      apply: true,
      toRewrite: 3,
      rewritten: 3,
      toRemoveSortKey: 2,
      sortKeyRemoved: 2,
      conflicts: [],
      failed: [],
    })
    expect(t.table.get('p1')).toMatchObject({
      publishedAt: '2026-05-01T00:00:00.000Z',
      publishedAtSortKey: '2026-05-01T00:00:00.000Z#p1',
    })
    expect('publishedAtSortKey' in t.table.get('p5')!).toBe(false)
  })

  it('a second run after apply finds everything ok (idempotent)', async () => {
    const t = fakeTable(sampleRows())
    await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    const writesAfterFirst = t.updates.length
    const second = await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    expect(t.updates.length).toBe(writesAfterFirst)
    expect(second).toMatchObject({ scanned: 6, ok: 5, toRewrite: 0, toRemoveSortKey: 0 })
    expect(second.unparseable.map((u) => u.postId)).toEqual(['p6'])
  })

  it('counts a conditional failure (concurrent edit) as a conflict and continues', async () => {
    const t = fakeTable(sampleRows())
    // An editor saves p1 between the scan and the update.
    t.onBeforeUpdate((input) => {
      if ((input.Key as { postId: string }).postId === 'p1') {
        t.table.get('p1')!.publishedAt = '2026-05-10T00:00:00.000Z'
      }
    })
    const lines: string[] = []
    const summary = await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      apply: true,
      log: (l) => lines.push(l),
      sleep: noSleep,
    })
    expect(summary.conflicts).toEqual([{ postId: 'p1', action: 'rewrite' }])
    expect(summary.rewritten).toBe(1) // p3 still migrated
    expect(summary.sortKeyRemoved).toBe(1) // p5 still migrated
    expect(summary.failed).toEqual([])
    expect(lines.some((l) => l.startsWith('CONFLICT postId=p1'))).toBe(true)
    // The editor's value survives.
    expect(t.table.get('p1')!.publishedAt).toBe('2026-05-10T00:00:00.000Z')
  })

  it('logs and records other write errors, then continues', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = fakeTable(sampleRows())
    t.onBeforeUpdate((input) => {
      if ((input.Key as { postId: string }).postId === 'p1') {
        const e = new Error('Rate exceeded')
        e.name = 'ProvisionedThroughputExceededException'
        throw e
      }
    })
    const summary = await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    expect(summary.failed).toEqual([
      {
        postId: 'p1',
        action: 'rewrite',
        error: 'ProvisionedThroughputExceededException: Rate exceeded',
      },
    ])
    expect(summary.rewritten).toBe(1)
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('rewrite failed for postId=p1'),
      expect.anything()
    )
    err.mockRestore()
  })

  it('follows LastEvaluatedKey across pages', async () => {
    const t = fakeTable(sampleRows())
    const summary = await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      pageSize: 2,
      log: silent,
      sleep: noSleep,
    })
    expect(t.scans).toHaveLength(3)
    expect(t.scans[0]!.ExclusiveStartKey).toBeUndefined()
    expect(t.scans[0]!.Limit).toBe(2)
    expect(t.scans[1]!.ExclusiveStartKey).toEqual({ postId: 'p2' })
    expect(t.scans[2]!.ExclusiveStartKey).toEqual({ postId: 'p4' })
    expect(summary.scanned).toBe(6)
  })

  it('throttles each write by 1000 / maxWritesPerSecond ms (default 10/s)', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const t = fakeTable(sampleRows())
    await runPublishedAtMigration({
      client: t.client,
      tableName: TABLE,
      apply: true,
      log: silent,
      sleep,
    })
    expect(sleep).toHaveBeenCalledTimes(t.updates.length)
    expect(sleep).toHaveBeenCalledWith(100)

    const sleep2 = vi.fn(() => Promise.resolve())
    const t2 = fakeTable(sampleRows())
    await runPublishedAtMigration({
      client: t2.client,
      tableName: TABLE,
      apply: true,
      maxWritesPerSecond: 4,
      log: silent,
      sleep: sleep2,
    })
    expect(sleep2).toHaveBeenCalledWith(250)
  })

  it('does not sleep in dry-run', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const t = fakeTable(sampleRows())
    await runPublishedAtMigration({ client: t.client, tableName: TABLE, log: silent, sleep })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('rejects a non-positive maxWritesPerSecond', async () => {
    const t = fakeTable(sampleRows())
    await expect(
      runPublishedAtMigration({
        client: t.client,
        tableName: TABLE,
        maxWritesPerSecond: 0,
        log: silent,
      })
    ).rejects.toThrow(/maxWritesPerSecond/)
  })
})
