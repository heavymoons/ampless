import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import type { ContentEventPayload } from 'ampless'
import { desiredPostTagRows, type PostTagItem } from '../events/posttag-sync.js'
import { comparePostTags, runPostTagCheck, type PostTagCheckClient } from './post-tags-check.js'

const POSTS = 'Post-abc-NONE'
const TAGS = 'PostTag-abc-NONE'
const CANONICAL = '2026-05-01T00:00:00.000Z'

function post(opts: Partial<ContentEventPayload> = {}): ContentEventPayload {
  return {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    status: 'published',
    format: 'markdown',
    excerpt: 'A summary',
    publishedAt: CANONICAL,
    tags: ['news'],
    ...opts,
  }
}

/**
 * In-memory Post + PostTag tables behind a fake DocumentClient: Scan (paged
 * by Limit), strongly consistent Get, Put, Delete. `onScan` may mutate state
 * to simulate an edit or a failure.
 */
function fakeDb(posts: object[], tagRows: object[]) {
  const postTable = new Map<string, Record<string, unknown>>(
    posts.map((p) => [(p as { postId: string }).postId, { ...p }])
  )
  const tagTable = new Map<string, Record<string, unknown>>(
    tagRows.map((r) => {
      const row = r as { tag: string; publishedAtPostId: string }
      return [`${row.tag}|${row.publishedAtPostId}`, { ...r }]
    })
  )
  const scans: Array<Record<string, unknown>> = []
  const gets: Array<Record<string, unknown>> = []
  const writes: string[] = []
  let failPutFor: string | undefined

  function scanPage(all: Array<Record<string, unknown>>, input: Record<string, unknown>) {
    const start = input.ExclusiveStartKey ? (input.ExclusiveStartKey as { i: number }).i : 0
    const limit = (input.Limit as number | undefined) ?? all.length
    const page = all.slice(start, start + limit)
    const more = start + limit < all.length
    return { Items: page, ...(more ? { LastEvaluatedKey: { i: start + limit } } : {}) }
  }

  const client: PostTagCheckClient = {
    async send(command) {
      const input = command.input as Record<string, unknown>
      if (command instanceof ScanCommand) {
        scans.push(input)
        const source = input.TableName === POSTS ? postTable : tagTable
        return scanPage(
          [...source.values()].map((r) => structuredClone(r)),
          input
        )
      }
      if (command instanceof GetCommand) {
        gets.push(input)
        const row = postTable.get((input.Key as { postId: string }).postId)
        return row ? { Item: structuredClone(row) } : {}
      }
      if (command instanceof PutCommand) {
        const item = input.Item as PostTagItem
        if (failPutFor === item.postId) {
          const e = new Error('Rate exceeded')
          e.name = 'ProvisionedThroughputExceededException'
          throw e
        }
        writes.push(`put ${item.tag}|${item.publishedAtPostId}`)
        tagTable.set(`${item.tag}|${item.publishedAtPostId}`, structuredClone(item) as never)
        return {}
      }
      if (command instanceof DeleteCommand) {
        const key = input.Key as { tag: string; publishedAtPostId: string }
        writes.push(`delete ${key.tag}|${key.publishedAtPostId}`)
        tagTable.delete(`${key.tag}|${key.publishedAtPostId}`)
        return {}
      }
      throw new Error('unexpected command')
    },
  }
  return {
    client,
    postTable,
    tagTable,
    scans,
    gets,
    writes,
    failPutsFor(postId: string) {
      failPutFor = postId
    },
  }
}

const silent = () => {}
const noSleep = () => Promise.resolve()

describe('comparePostTags', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no mismatch when the rows equal the desired rows (metadata attributes ignored)', () => {
    const p = post()
    const rows = desiredPostTagRows(p).map((r) => ({ ...r, __typename: 'PostTag', createdAt: 'x' }))
    expect(comparePostTags(new Map([['p1', p]]), rows)).toEqual([])
  })

  it('classifies stale, content and missing rows', () => {
    const published = post({ tags: ['news', 'tech'] })
    const draft = post({ postId: 'p2', status: 'draft' })
    const [news, tech] = desiredPostTagRows(published)
    const rows = [
      // Desired key, outdated title.
      { ...news!, title: 'Old title' },
      // Legacy verbatim key of p1 → key-mismatch.
      { ...news!, publishedAtPostId: '2026-05-01T09:00:00+09:00#p1' },
      // Row of a draft → not-indexed (exposes the draft's title).
      { ...desiredPostTagRows({ ...draft, status: 'published' })[0]! },
      // Row of a deleted post, postId only in the SK.
      { tag: 'news', publishedAtPostId: `${CANONICAL}#gone` },
    ]
    // `tech` is missing.
    const res = comparePostTags(
      new Map<string, ContentEventPayload | null>([
        ['p1', published],
        ['p2', draft],
      ]),
      rows
    )
    expect(res).toEqual([
      { kind: 'content', postId: 'p1', key: { tag: 'news', publishedAtPostId: `${CANONICAL}#p1` } },
      {
        kind: 'stale',
        postId: 'p1',
        key: { tag: 'news', publishedAtPostId: '2026-05-01T09:00:00+09:00#p1' },
        reason: 'key-mismatch',
      },
      {
        kind: 'stale',
        postId: 'p2',
        key: { tag: 'news', publishedAtPostId: `${CANONICAL}#p2` },
        reason: 'not-indexed',
      },
      {
        kind: 'stale',
        postId: 'gone',
        key: { tag: 'news', publishedAtPostId: `${CANONICAL}#gone` },
        reason: 'post-missing',
      },
      {
        kind: 'missing',
        postId: 'p1',
        key: { tag: tech!.tag, publishedAtPostId: tech!.publishedAtPostId },
      },
    ])
  })

  it('an unparseable publishedAt yields no desired rows, so its rows are stale', () => {
    const bad = post({ publishedAt: 'not-a-date' })
    const res = comparePostTags(new Map([['p1', bad]]), [
      { ...desiredPostTagRows(post())[0]!, publishedAtPostId: 'not-a-date#p1' },
    ])
    expect(res).toMatchObject([{ kind: 'stale', postId: 'p1', reason: 'not-indexed' }])
  })
})

describe('runPostTagCheck', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // p1: published with an outdated title row + a missing tag row.
  // p2: draft with a leftover public row (the #413 hazard).
  // p3: clean.
  function scenario() {
    const p1 = post({ tags: ['news', 'tech'], title: 'New title' })
    const p2 = post({
      postId: 'p2',
      status: 'draft',
      title: 'Draft title',
      excerpt: 'Draft excerpt',
    })
    const p3 = post({ postId: 'p3', tags: ['life'] })
    const rows = [
      { ...desiredPostTagRows(p1)[0]!, title: 'Old title' },
      desiredPostTagRows({ ...p2, status: 'published' })[0]!,
      ...desiredPostTagRows(p3),
    ]
    return fakeDb([p1, p2, p3], rows)
  }

  it('dry-run: scans both tables strongly, reports, writes nothing', async () => {
    const db = scenario()
    const lines: string[] = []
    const summary = await runPostTagCheck({
      client: db.client,
      postTable: POSTS,
      postTagTable: TAGS,
      pageSize: 2,
      log: (l) => lines.push(l),
      sleep: noSleep,
    })
    expect(db.writes).toEqual([])
    expect(db.scans.length).toBeGreaterThanOrEqual(4) // paged, both tables
    expect(db.scans.every((s) => s.ConsistentRead === true)).toBe(true)
    expect(db.scans.some((s) => s.TableName === TAGS)).toBe(true)
    const postScan = db.scans.find((s) => s.TableName === POSTS)!
    expect(postScan.ExpressionAttributeNames).toMatchObject({ '#status': 'status' })
    expect(summary).toMatchObject({
      apply: false,
      postsScanned: 3,
      postTagRowsScanned: 3,
      repaired: 0,
      failed: [],
      remaining: null,
    })
    expect(summary.mismatches.map((m) => `${m.kind}:${m.postId}`).sort()).toEqual([
      'content:p1',
      'missing:p1',
      'stale:p2',
    ])
    expect(lines.some((l) => l.startsWith('STALE ') && l.includes('postId=p2'))).toBe(true)
  })

  it('apply: rebuilds each affected post authoritatively and re-checks to zero', async () => {
    const db = scenario()
    const sleep = vi.fn(() => Promise.resolve())
    const summary = await runPostTagCheck({
      client: db.client,
      postTable: POSTS,
      postTagTable: TAGS,
      apply: true,
      log: silent,
      sleep,
    })
    expect(summary.repaired).toBe(2) // p1, p2 (p3 untouched)
    expect(summary.failed).toEqual([])
    expect(summary.remaining).toEqual([])
    // Rebuild reads are strongly consistent Gets of the affected posts only.
    expect(new Set(db.gets.map((g) => (g.Key as { postId: string }).postId))).toEqual(
      new Set(['p1', 'p2'])
    )
    expect(db.gets.every((g) => g.ConsistentRead === true)).toBe(true)
    // The draft's row is gone; nothing exposes its title / excerpt.
    const dump = JSON.stringify([...db.tagTable.values()])
    expect(dump).not.toContain('Draft title')
    expect(dump).not.toContain('Draft excerpt')
    expect([...db.tagTable.keys()].sort()).toEqual([
      `life|${CANONICAL}#p3`,
      `news|${CANONICAL}#p1`,
      `tech|${CANONICAL}#p1`,
    ])
    // Rate limit: one sleep per repaired post, scaled by its writes (10/s).
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(200) // p1: 2 puts
    expect(sleep).toHaveBeenCalledWith(100) // p2: 1 delete
  })

  it('apply: a stale row under a key the post no longer derives is removed via extra candidates', async () => {
    const p1 = post({ tags: ['news'] })
    // A row for a tag the post dropped long ago: not derivable from the
    // post's current state, only from the scan.
    const orphan = { ...desiredPostTagRows(p1)[0]!, tag: 'ancient' }
    const db = fakeDb([p1], [...desiredPostTagRows(p1), orphan])
    const summary = await runPostTagCheck({
      client: db.client,
      postTable: POSTS,
      postTagTable: TAGS,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    expect(summary.mismatches).toMatchObject([{ kind: 'stale', reason: 'key-mismatch' }])
    expect(summary.remaining).toEqual([])
    expect(db.writes).toContain(`delete ancient|${CANONICAL}#p1`)
  })

  it('apply: rows of a deleted post are removed', async () => {
    const gone = desiredPostTagRows(post({ postId: 'gone' }))
    const db = fakeDb([], gone)
    const summary = await runPostTagCheck({
      client: db.client,
      postTable: POSTS,
      postTagTable: TAGS,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    expect(summary.mismatches).toMatchObject([{ kind: 'stale', reason: 'post-missing' }])
    expect(db.tagTable.size).toBe(0)
    expect(summary.remaining).toEqual([])
  })

  it('apply: a failing repair is logged, recorded, and the rest continue', async () => {
    const db = scenario()
    db.failPutsFor('p1')
    const summary = await runPostTagCheck({
      client: db.client,
      postTable: POSTS,
      postTagTable: TAGS,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    expect(summary.failed).toEqual([
      { postId: 'p1', error: 'ProvisionedThroughputExceededException: Rate exceeded' },
    ])
    expect(summary.repaired).toBe(1)
    expect(summary.remaining!.map((m) => m.postId)).toEqual(expect.arrayContaining(['p1']))
    expect(summary.remaining!.some((m) => m.postId === 'p2')).toBe(false)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('repair failed for postId=p1'),
      expect.anything()
    )
  })

  it('clean tables → zero mismatches, no writes', async () => {
    const p = post()
    const db = fakeDb([p], desiredPostTagRows(p))
    const summary = await runPostTagCheck({
      client: db.client,
      postTable: POSTS,
      postTagTable: TAGS,
      apply: true,
      log: silent,
      sleep: noSleep,
    })
    expect(summary.mismatches).toEqual([])
    expect(summary.remaining).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('rejects a non-positive maxWritesPerSecond', async () => {
    const db = fakeDb([], [])
    await expect(
      runPostTagCheck({
        client: db.client,
        postTable: POSTS,
        postTagTable: TAGS,
        maxWritesPerSecond: 0,
        log: silent,
      })
    ).rejects.toThrow(/maxWritesPerSecond/)
  })
})
