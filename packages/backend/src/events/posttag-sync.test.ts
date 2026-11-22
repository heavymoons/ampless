import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type { ContentEventPayload, PostIndexEventPayload } from 'ampless'
import {
  POST_STATE_PROJECTION,
  buildPostStateCondition,
  candidateKeys,
  computePostTagDiff,
  desiredPostTagRows,
  isPostStateGuardFailure,
  planPostTagRebuild,
  postPayloadFromItem,
  postStateFingerprint,
  postStateFromItem,
  postTagRowsFingerprint,
  reconcilePostTagsForPost,
  stableStringify,
  type PostTagItem,
  type PostTagKey,
  type PostTagSyncClient,
} from './posttag-sync.js'
import { evaluatePostStateCondition, guardCancelled } from '../__fixtures__/post-state-condition.js'

function published(opts: Partial<ContentEventPayload> = {}): ContentEventPayload {
  return {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    status: 'published',
    format: 'markdown',
    excerpt: 'A summary',
    publishedAt: '2026-05-01T00:00:00.000Z',
    tags: ['news', 'tech'],
    ...opts,
  }
}

describe('computePostTagDiff', () => {
  it('INSERT of a published post → put for each tag, no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published(),
    })
    expect(deletes).toEqual([])
    expect(puts).toHaveLength(2)
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
    for (const p of puts) {
      expect(p.publishedAtPostId).toBe('2026-05-01T00:00:00.000Z#p1')
      expect(p.postId).toBe('p1')
      expect(p.slug).toBe('hello')
      // format / excerpt are denormalized so listPostsByTag renders them
      // without a second lookup.
      expect(p.format).toBe('markdown')
      expect(p.excerpt).toBe('A summary')
    }
  })

  it('carries a non-markdown format onto every PostTag row', () => {
    const { puts } = computePostTagDiff({
      previous: null,
      next: published({ format: 'html', tags: ['news'] }),
    })
    expect(puts).toHaveLength(1)
    expect(puts[0]!.format).toBe('html')
  })

  it('omits format / excerpt when absent (no undefined attributes for the DDB put)', () => {
    const { puts } = computePostTagDiff({
      previous: null,
      next: published({ format: undefined, excerpt: undefined, tags: ['news'] }),
    })
    expect(puts).toHaveLength(1)
    expect('format' in puts[0]!).toBe(false)
    expect('excerpt' in puts[0]!).toBe(false)
  })

  it('INSERT of a draft → no puts, no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published({ status: 'draft' }),
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('published post without publishedAt → no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published({ publishedAt: undefined }),
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('published post with no tags → no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: null,
      next: published({ tags: [] }),
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('MODIFY: remove a tag → delete for the removed tag, puts for the remaining', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news', 'tech'] }),
      next: published({ tags: ['news'] }),
    })
    expect(deletes).toEqual([
      { tag: 'tech', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
    ])
    expect(puts.map((p) => p.tag)).toEqual(['news'])
  })

  it('MODIFY: add a tag → puts for both tags (new + carry-over), no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news'] }),
      next: published({ tags: ['news', 'tech'] }),
    })
    expect(deletes).toEqual([])
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
  })

  it('MODIFY: title-only change → puts for every tag, no deletes (upsert behaviour)', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ title: 'Old' }),
      next: published({ title: 'New' }),
    })
    expect(deletes).toEqual([])
    expect(puts).toHaveLength(2)
    for (const p of puts) {
      expect(p.title).toBe('New')
    }
  })

  it('MODIFY: publishedAt change → deletes for old key, puts for new key', () => {
    const oldStamp = '2026-05-01T00:00:00.000Z'
    const newStamp = '2026-06-01T00:00:00.000Z'
    const { deletes, puts } = computePostTagDiff({
      previous: published({ publishedAt: oldStamp, tags: ['news'] }),
      next: published({ publishedAt: newStamp, tags: ['news'] }),
    })
    expect(deletes).toEqual([
      { tag: 'news', publishedAtPostId: `${oldStamp}#p1` },
    ])
    expect(puts).toHaveLength(1)
    expect(puts[0]!.publishedAtPostId).toBe(`${newStamp}#p1`)
  })

  it('MODIFY: published → draft (unpublish) → deletes for every previous tag, no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news', 'tech'] }),
      next: published({ status: 'draft' }),
    })
    expect(deletes).toHaveLength(2)
    expect(deletes.map((d) => d.tag).sort()).toEqual(['news', 'tech'])
    expect(puts).toEqual([])
  })

  it('MODIFY: draft → published → puts for every new tag, no deletes', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ status: 'draft' }),
      next: published({ tags: ['news', 'tech'] }),
    })
    expect(deletes).toEqual([])
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
  })

  it('REMOVE of a published post → deletes for every previous tag, no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ tags: ['news', 'tech'] }),
      next: null,
    })
    expect(deletes).toHaveLength(2)
    expect(deletes.map((d) => d.tag).sort()).toEqual(['news', 'tech'])
    expect(puts).toEqual([])
  })

  it('REMOVE of a draft → no deletes, no puts', () => {
    const { deletes, puts } = computePostTagDiff({
      previous: published({ status: 'draft' }),
      next: null,
    })
    expect(deletes).toEqual([])
    expect(puts).toEqual([])
  })

  it('null tag entries / empty-string tags are filtered out', () => {
    const { puts } = computePostTagDiff({
      previous: null,
      next: published({ tags: ['news', '', 'tech'] }),
    })
    expect(puts.map((p) => p.tag).sort()).toEqual(['news', 'tech'])
  })

  describe('timezone offsets (AWSDateTime written verbatim through the API)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('writes the SK and publishedAt in canonical UTC for an offset value', () => {
      const { deletes, puts } = computePostTagDiff({
        previous: null,
        next: published({ publishedAt: '2026-05-01T09:00:00+09:00', tags: ['news'] }),
      })
      expect(deletes).toEqual([])
      expect(puts).toHaveLength(1)
      expect(puts[0]!.publishedAtPostId).toBe('2026-05-01T00:00:00.000Z#p1')
      expect(puts[0]!.publishedAt).toBe('2026-05-01T00:00:00.000Z')
    })

    it('re-saving a legacy offset post deletes its verbatim-keyed row and keeps the canonical one', () => {
      const legacy = published({ publishedAt: '2026-05-01T09:00:00+09:00', tags: ['news'] })
      const { deletes, puts } = computePostTagDiff({
        previous: legacy,
        next: { ...legacy, title: 'Edited' },
      })
      expect(deletes).toEqual([{ tag: 'news', publishedAtPostId: '2026-05-01T09:00:00+09:00#p1' }])
      expect(puts.map((p) => p.publishedAtPostId)).toEqual(['2026-05-01T00:00:00.000Z#p1'])
    })

    it('offset previous → canonical next with the same instant: legacy row deleted, canonical row put', () => {
      const { deletes, puts } = computePostTagDiff({
        previous: published({ publishedAt: '2026-04-30T19:00:00-05:00', tags: ['news'] }),
        next: published({ publishedAt: '2026-05-01T00:00:00.000Z', tags: ['news'] }),
      })
      expect(deletes).toEqual([{ tag: 'news', publishedAtPostId: '2026-04-30T19:00:00-05:00#p1' }])
      expect(puts.map((p) => p.publishedAtPostId)).toEqual(['2026-05-01T00:00:00.000Z#p1'])
    })

    it('unpublishing a legacy offset post deletes both possible keys per tag', () => {
      const { deletes, puts } = computePostTagDiff({
        previous: published({ publishedAt: '2026-05-01T09:00:00+09:00', tags: ['news'] }),
        next: published({ publishedAt: '2026-05-01T09:00:00+09:00', status: 'draft' }),
      })
      expect(puts).toEqual([])
      expect(deletes).toEqual([
        { tag: 'news', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
        { tag: 'news', publishedAtPostId: '2026-05-01T09:00:00+09:00#p1' },
      ])
    })

    it('canonical previous yields one delete key per tag (no duplicates)', () => {
      const { deletes } = computePostTagDiff({
        previous: published({ tags: ['news'] }),
        next: null,
      })
      expect(deletes).toEqual([{ tag: 'news', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' }])
    })

    it('unparseable publishedAt → no puts (logged), previous verbatim rows still deleted', () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { deletes, puts } = computePostTagDiff({
        previous: published({ publishedAt: 'not-a-date', tags: ['news'] }),
        next: published({ publishedAt: 'not-a-date', tags: ['news'] }),
      })
      expect(puts).toEqual([])
      expect(deletes).toEqual([{ tag: 'news', publishedAtPostId: 'not-a-date#p1' }])
      expect(err).toHaveBeenCalledWith(expect.stringContaining('unparseable publishedAt'))
    })
  })
})

// ---------------------------------------------------------------------------
// Authoritative rebuild (reconcilePostTagsForPost)
// ---------------------------------------------------------------------------

describe('desiredPostTagRows', () => {
  it('published with tags → one canonical row per tag', () => {
    const rows = desiredPostTagRows(published({ publishedAt: '2026-05-01T09:00:00+09:00' }))
    expect(rows.map((r) => `${r.tag}|${r.publishedAtPostId}`)).toEqual([
      'news|2026-05-01T00:00:00.000Z#p1',
      'tech|2026-05-01T00:00:00.000Z#p1',
    ])
  })

  it('draft, deleted (null), no tags, no publishedAt → no rows', () => {
    expect(desiredPostTagRows(published({ status: 'draft' }))).toEqual([])
    expect(desiredPostTagRows(null)).toEqual([])
    expect(desiredPostTagRows(published({ tags: [] }))).toEqual([])
    expect(desiredPostTagRows(published({ publishedAt: undefined }))).toEqual([])
  })
})

describe('candidateKeys', () => {
  it('covers canonical + verbatim keys of previous and next, whatever their status', () => {
    const keys = candidateKeys({
      previous: published({ publishedAt: '2026-05-01T09:00:00+09:00', tags: ['news'] }),
      next: published({ status: 'draft', tags: ['tech'] }),
    })
    expect(keys).toEqual([
      { tag: 'news', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
      { tag: 'news', publishedAtPostId: '2026-05-01T09:00:00+09:00#p1' },
      { tag: 'tech', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
    ])
  })

  it('adds extra keys and deduplicates', () => {
    const keys = candidateKeys(
      { previous: published({ tags: ['news'] }), next: published({ tags: ['news'] }) },
      [
        { tag: 'news', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
        { tag: 'old', publishedAtPostId: 'x#p1' },
      ]
    )
    expect(keys).toEqual([
      { tag: 'news', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
      { tag: 'old', publishedAtPostId: 'x#p1' },
    ])
  })

  it('null payload → only extras', () => {
    expect(candidateKeys(null)).toEqual([])
  })
})

describe('planPostTagRebuild', () => {
  it('deletes = candidates \\ desired keys; puts = desired', () => {
    const desired = desiredPostTagRows(published({ tags: ['news'] }))
    const plan = planPostTagRebuild(
      [
        { tag: 'news', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
        { tag: 'tech', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
      ],
      desired
    )
    expect(plan.deletes).toEqual([
      { tag: 'tech', publishedAtPostId: '2026-05-01T00:00:00.000Z#p1' },
    ])
    expect(plan.puts).toBe(desired)
  })
})

describe('stableStringify / postTagRowsFingerprint', () => {
  it('ignores object key order and row order, but not content', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 })
    )
    const rows = desiredPostTagRows(published())
    expect(postTagRowsFingerprint([...rows].reverse())).toBe(postTagRowsFingerprint(rows))
    const retitled = desiredPostTagRows(published({ title: 'Other' }))
    expect(postTagRowsFingerprint(retitled)).not.toBe(postTagRowsFingerprint(rows))
  })
})


describe('Post state fingerprint / guard condition', () => {
  const item = {
    postId: 'p1',
    status: 'published',
    publishedAt: '2026-05-01T00:00:00.000Z',
    tags: ['news', 'tech'],
    slug: 'hello',
    title: 'Hello',
    excerpt: null,
    updatedAt: '2026-05-02T00:00:00.000Z',
    body: 'not part of the state',
  }

  it('projects exactly the fingerprint attributes through attribute names', () => {
    expect(POST_STATE_PROJECTION.ProjectionExpression).toBe(
      '#postId, #status, #publishedAt, #tags, #slug, #title, #excerpt, #format, #updatedAt'
    )
    expect(POST_STATE_PROJECTION.ExpressionAttributeNames['#status']).toBe('status')
    expect(postStateFromItem(item)).toEqual({
      postId: 'p1',
      status: 'published',
      publishedAt: '2026-05-01T00:00:00.000Z',
      tags: ['news', 'tech'],
      slug: 'hello',
      title: 'Hello',
      excerpt: null,
      updatedAt: '2026-05-02T00:00:00.000Z',
    })
    expect(postStateFromItem(undefined)).toBeNull()
  })

  it('builds = for values, attribute_type NULL for null, attribute_not_exists for absent', () => {
    const c = buildPostStateCondition(postStateFromItem(item)!)
    expect(c.ConditionExpression).toBe(
      '#postId = :postId AND #status = :status AND #publishedAt = :publishedAt AND #tags = :tags' +
        ' AND #slug = :slug AND #title = :title AND attribute_type(#excerpt, :nullType)' +
        ' AND attribute_not_exists(#format) AND #updatedAt = :updatedAt'
    )
    expect(c.ExpressionAttributeValues).toEqual({
      ':postId': 'p1',
      ':status': 'published',
      ':publishedAt': '2026-05-01T00:00:00.000Z',
      ':tags': ['news', 'tech'],
      ':slug': 'hello',
      ':title': 'Hello',
      ':nullType': 'NULL',
      ':updatedAt': '2026-05-02T00:00:00.000Z',
    })
    expect(Object.values(c.ExpressionAttributeValues)).not.toContain(undefined)
    expect(c.ExpressionAttributeNames).toMatchObject({ '#format': 'format', '#excerpt': 'excerpt' })
  })

  it('the fake evaluator agrees with the builder (same state passes, any change fails)', () => {
    const state = postStateFromItem(item)!
    const c = buildPostStateCondition(state)
    expect(evaluatePostStateCondition(item, c)).toBe(true)
    for (const changed of [
      { ...item, tags: ['tech', 'news'] },
      { ...item, excerpt: 'now set' },
      { ...item, format: 'markdown' },
      { ...item, status: 'draft' },
      { ...item, updatedAt: 'later' },
      { ...item, excerpt: undefined },
    ]) {
      expect(evaluatePostStateCondition(changed, c)).toBe(false)
    }
    expect(evaluatePostStateCondition(null, c)).toBe(false)
  })

  it('fingerprint: absent ≠ null, list order matters, non-state attributes ignored, sets compared as sets', () => {
    const base = postStateFromItem(item)
    expect(postStateFingerprint(base)).toBe(postStateFingerprint(postStateFromItem({ ...item, body: 'x' })))
    expect(postStateFingerprint(base)).not.toBe(
      postStateFingerprint(postStateFromItem({ ...item, excerpt: undefined }))
    )
    expect(postStateFingerprint(base)).not.toBe(
      postStateFingerprint(postStateFromItem({ ...item, tags: ['tech', 'news'] }))
    )
    expect(postStateFingerprint(postStateFromItem({ ...item, tags: new Set(['a', 'b']) }))).toBe(
      postStateFingerprint(postStateFromItem({ ...item, tags: new Set(['b', 'a']) }))
    )
    expect(postStateFingerprint(postStateFromItem({ ...item, tags: new Set(['a']) }))).not.toBe(
      postStateFingerprint(postStateFromItem({ ...item, tags: new Set(['b']) }))
    )
    expect(postStateFingerprint(null)).toBe('absent')
  })

  it('isPostStateGuardFailure only for a ConditionalCheckFailed on the ConditionCheck', () => {
    expect(isPostStateGuardFailure(guardCancelled())).toBe(true)
    const conflict = Object.assign(new Error('x'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'TransactionConflict' }, { Code: 'None' }],
    })
    expect(isPostStateGuardFailure(conflict)).toBe(false)
    const throttled = Object.assign(new Error('x'), { name: 'ThrottlingException' })
    expect(isPostStateGuardFailure(throttled)).toBe(false)
    expect(isPostStateGuardFailure(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fake store: Post + PostTag tables that evaluate the guard atomically per
// transaction, record whether every committed row was valid at commit time,
// and let a test inject Post writes or crashes before / after any call.
// ---------------------------------------------------------------------------

type Item = object
type Row = Record<string, unknown>
type AnyCommand = GetCommand | DeleteCommand | TransactWriteCommand | PutCommand

class Crash extends Error {
  constructor(where: string) {
    super(`injected crash ${where}`)
    this.name = 'InjectedCrash'
  }
}

interface CallInfo {
  /** 'get' | 'delete' | 'transact' | 'put' */
  op: string
  /** 1-based count of this op kind across the store. */
  n: number
  actor: string
}

type Hook = (info: CallInfo, cmd: AnyCommand) => void | Promise<void>

function opOf(cmd: AnyCommand): string {
  if (cmd instanceof GetCommand) return 'get'
  if (cmd instanceof DeleteCommand) return 'delete'
  if (cmd instanceof TransactWriteCommand) return 'transact'
  if (cmd instanceof PutCommand) return 'put'
  throw new Error('unexpected command')
}

const keyOf = (r: { tag: string; publishedAtPostId: string }) => `${r.tag}|${r.publishedAtPostId}`

function fakeStore(initialPost: Item | null, initialRows: PostTagItem[] = []) {
  let post: Row | null = initialPost ? (structuredClone(initialPost) as Row) : null
  let clock = 0
  const rows = new Map<string, { row: PostTagItem; validAtCommit: boolean }>()
  for (const r of initialRows) rows.set(keyOf(r), { row: structuredClone(r), validAtCommit: true })
  const violations: string[] = []
  const counts: Record<string, number> = {}
  const trace: string[] = []
  const hooks: { before?: Hook; after?: Hook } = {}

  const currentRows = () => desiredPostTagRows(postPayloadFromItem(post))

  /** At every instant, every stored row was one of rows(Post) when committed. */
  function checkInvariant(where: string) {
    for (const [k, r] of rows) {
      if (!r.validAtCommit) violations.push(`${where}: ${k} ${JSON.stringify(r.row)}`)
    }
  }

  function commitRow(item: PostTagItem) {
    const valid = currentRows().some((r) => stableStringify(r) === stableStringify(item))
    rows.set(keyOf(item), { row: structuredClone(item), validAtCommit: valid })
  }

  function apply(cmd: AnyCommand): unknown {
    if (cmd instanceof GetCommand) {
      if (!post) return {}
      const names = Object.values(cmd.input.ExpressionAttributeNames ?? {})
      const projected: Row = {}
      for (const n of names) if (post[n] !== undefined) projected[n] = structuredClone(post[n])
      return { Item: projected }
    }
    if (cmd instanceof DeleteCommand) {
      rows.delete(keyOf(cmd.input.Key as PostTagKey))
      return {}
    }
    if (cmd instanceof TransactWriteCommand) {
      const [check, put] = cmd.input.TransactItems!
      if (!check?.ConditionCheck || !put?.Put || cmd.input.TransactItems!.length !== 2) {
        throw new Error('fake: expected [ConditionCheck, Put]')
      }
      if (!evaluatePostStateCondition(post, check.ConditionCheck)) throw guardCancelled()
      commitRow(put.Put.Item as unknown as PostTagItem)
      return {}
    }
    // Plain PutCommand: only used to prove the invariant checker works.
    commitRow(cmd.input.Item as unknown as PostTagItem)
    return {}
  }

  function clientFor(actor: string): PostTagSyncClient {
    return {
      async send(command) {
        const cmd = command as AnyCommand
        const op = opOf(cmd)
        counts[op] = (counts[op] ?? 0) + 1
        const info = { op, n: counts[op]!, actor }
        await hooks.before?.(info, cmd)
        let result: unknown
        try {
          result = apply(cmd)
          trace.push(`${actor}:${op}`)
        } finally {
          checkInvariant(`${actor} ${op}#${info.n}`)
        }
        await hooks.after?.(info, cmd)
        return result
      },
    }
  }

  return {
    hooks,
    violations,
    counts,
    trace,
    client: clientFor('w'),
    clientFor,
    get post() {
      return post
    },
    rows,
    /** Rows as plain content, sorted by key. */
    rowContents() {
      return [...rows.values()].map((r) => r.row).sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    },
    currentRows,
    /**
     * An editor write (every write bumps updatedAt, as AppSync does). Returns
     * the refresh event the dispatcher emits for it.
     */
    writePost(next: Item | null): PostIndexEventPayload {
      const previous = postPayloadFromItem(post)
      post = next ? { ...structuredClone(next), updatedAt: `t${++clock}` } : null
      checkInvariant('editor write')
      return { previous, next: postPayloadFromItem(post) }
    },
  }
}

type Store = ReturnType<typeof fakeStore>

const RAW_PLUS9 = '2026-05-01T09:00:00+09:00'
const CANONICAL = '2026-05-01T00:00:00.000Z'
const silent = () => {}

function rebuild(
  store: Store,
  payload: PostIndexEventPayload | null,
  opts: { client?: PostTagSyncClient; extra?: PostTagKey[]; beforeWrite?: () => Promise<void> } = {}
) {
  return reconcilePostTagsForPost({
    client: opts.client ?? store.client,
    postTable: 'posts',
    postTagTable: 'tags',
    postId: 'p1',
    candidates: candidateKeys(payload, opts.extra ?? []),
    log: silent,
    ...(opts.beforeWrite ? { beforeWrite: opts.beforeWrite } : {}),
  })
}

/** Apply a payload the old way (payload-only diff, unguarded Put). */
async function applyPayloadOnly(store: Store, payload: PostIndexEventPayload): Promise<void> {
  const { deletes, puts } = computePostTagDiff(payload)
  for (const key of deletes) {
    await store.client.send(new DeleteCommand({ TableName: 'tags', Key: key }))
  }
  for (const item of puts) {
    await store.client.send(new PutCommand({ TableName: 'tags', Item: item }) as never)
  }
}

describe('reconcilePostTagsForPost', () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const pub = published({ tags: ['news', 'tech'], title: 'Public title' })
  const draftOf = (p: ContentEventPayload) => ({
    ...p,
    status: 'draft' as const,
    title: 'Secret draft title',
    excerpt: 'Secret draft excerpt',
  })

  it('invariant checker sanity: an unguarded Put of a stale state is flagged', async () => {
    const store = fakeStore(draftOf(pub))
    await applyPayloadOnly(store, { previous: null, next: pub })
    expect(store.violations.length).toBeGreaterThan(0)
  })

  // (a) ------------------------------------------------------------------
  it('(a) Post becomes a draft between the read and the first Put → rejected, zero rows, never exposed', async () => {
    const store = fakeStore(null)
    const e0 = store.writePost(pub)
    let eDraft: PostIndexEventPayload | undefined
    store.hooks.before = (info) => {
      if (info.op === 'transact' && info.n === 1) eDraft = store.writePost(draftOf(pub))
    }
    const res = await rebuild(store, e0)
    expect(res).toMatchObject({ guardFailures: 1, puts: 0, rows: [] })
    expect(store.rows.size).toBe(0)
    store.hooks.before = undefined
    await rebuild(store, eDraft!)
    expect(store.rows.size).toBe(0)
    expect(store.violations).toEqual([])
  })

  it('(a) Post becomes a draft between two Puts → second rejected, the first row is deleted', async () => {
    const store = fakeStore(null)
    const e0 = store.writePost(pub)
    store.hooks.before = (info) => {
      if (info.op === 'transact' && info.n === 2) store.writePost(draftOf(pub))
    }
    const res = await rebuild(store, e0)
    expect(res).toMatchObject({ guardFailures: 1, puts: 1, attempts: 2, rows: [] })
    expect(store.rows.size).toBe(0)
    expect(store.violations).toEqual([])
  })

  // (b) ------------------------------------------------------------------
  for (const crashAt of ['after the first Put', 'before the re-read'] as const) {
    for (const order of ['draft refresh first', 'retried message first'] as const) {
      it(`(b) crash ${crashAt}, then unpublish; ${order} → zero rows`, async () => {
        const store = fakeStore(null)
        const e0 = store.writePost(pub)
        if (crashAt === 'after the first Put') {
          store.hooks.after = (info) => {
            if (info.op === 'transact' && info.n === 1) throw new Crash(crashAt)
          }
        } else {
          store.hooks.before = (info) => {
            if (info.op === 'get' && info.n === 2) throw new Crash(crashAt)
          }
        }
        await expect(rebuild(store, e0)).rejects.toThrow(/injected crash/)
        expect(store.rows.size).toBeGreaterThan(0) // committed while published
        store.hooks.after = undefined
        store.hooks.before = undefined

        const eDraft = store.writePost(draftOf(pub))
        const runs = order === 'draft refresh first' ? [eDraft, e0] : [e0, eDraft]
        for (const e of runs) await rebuild(store, e)
        expect(store.rows.size).toBe(0)
        expect(store.violations).toEqual([])
      })
    }
  }

  // (c) ------------------------------------------------------------------
  it('(c) crash after a delete → the retry restores the rows', async () => {
    const s1 = published({ tags: ['news', 'tech'], title: 'One' })
    const store = fakeStore(null)
    store.writePost(s1)
    await rebuild(store, null)
    const e2 = store.writePost({ ...s1, tags: ['tech', 'life'], title: 'Two' })
    store.hooks.after = (info) => {
      if (info.op === 'delete' && info.n === 1) throw new Crash('after delete')
    }
    await expect(rebuild(store, e2)).rejects.toThrow(/injected crash/)
    store.hooks.after = undefined
    await rebuild(store, e2) // SQS retry
    expect(store.rowContents()).toEqual(store.currentRows().sort((a, b) => keyOf(a).localeCompare(keyOf(b))))
    expect(store.violations).toEqual([])
  })

  it('(c) a stale worker deletes a valid row of a newer state, then crashes → missing only, retry restores', async () => {
    const s1 = published({ tags: ['news'], title: 'One' })
    const store = fakeStore(null)
    const eInsert = store.writePost(s1)
    const eDraft = store.writePost(draftOf(s1))
    // The stale worker reads the draft …
    let publishEvent: PostIndexEventPayload | undefined
    store.hooks.before = async (info) => {
      if (info.actor === 'stale' && info.op === 'delete' && info.n === 1) {
        // … meanwhile the post is republished and a fresh worker indexes it.
        store.hooks.before = undefined
        publishEvent = store.writePost(s1)
        await rebuild(store, publishEvent, { client: store.clientFor('fresh') })
        expect(store.rows.size).toBe(1)
      }
    }
    store.hooks.after = (info) => {
      if (info.actor === 'stale' && info.op === 'delete') throw new Crash('after stale delete')
    }
    await expect(rebuild(store, eDraft, { client: store.clientFor('stale') })).rejects.toThrow(
      /injected crash/
    )
    // The stale delete removed the newer state's valid row: missing, not exposed.
    expect(store.rows.size).toBe(0)
    store.hooks.after = undefined
    await rebuild(store, eDraft) // SQS retry of the stale message
    expect(store.rowContents()).toEqual(store.currentRows())
    await rebuild(store, eInsert)
    expect(store.rowContents()).toEqual(store.currentRows())
    expect(store.violations).toEqual([])
  })

  // (e) ------------------------------------------------------------------
  it('(e) throws (and logs) when every guarded Put meets a changed Post', async () => {
    const store = fakeStore(null)
    const e0 = store.writePost(pub)
    let i = 0
    store.hooks.before = (info) => {
      if (info.op === 'transact') store.writePost({ ...pub, title: `T${++i}` })
    }
    await expect(rebuild(store, e0)).rejects.toThrow(/did not converge after 5 attempts/)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('guardFailures=5'))
    expect(store.counts.get).toBe(6) // initial read + one per attempt
    expect(store.violations).toEqual([])
  })

  it('(e) throws when the re-read never matches (Post changes after every rebuild)', async () => {
    const store = fakeStore(null)
    const e0 = store.writePost(pub)
    let i = 0
    store.hooks.before = (info) => {
      if (info.op === 'get' && info.n > 1) store.writePost({ ...pub, title: `T${++i}` })
    }
    await expect(rebuild(store, e0)).rejects.toThrow(/did not converge after 5 attempts/)
    expect(store.violations).toEqual([])
  })

  // (f) ------------------------------------------------------------------
  // The migration interleaving from the #413 review:
  //   - the Post starts published with a raw `+09:00` date and tag rows;
  //   - A = migration rewrite (previous raw, next canonical, published);
  //   - B = editor unpublishes (previous canonical published, next draft);
  //   - the SQS standard queue delivers B before A.
  const rawPublished = published({
    publishedAt: RAW_PLUS9,
    title: 'Secret draft title',
    excerpt: 'Secret draft excerpt',
  })
  const canonicalPublished = { ...rawPublished, publishedAt: CANONICAL }
  const draft = { ...canonicalPublished, status: 'draft' as const }
  const eventA: PostIndexEventPayload = { previous: rawPublished, next: canonicalPublished }
  const eventB: PostIndexEventPayload = { previous: canonicalPublished, next: draft }
  const oldRows = (): PostTagItem[] => [
    ...desiredPostTagRows(rawPublished),
    { ...desiredPostTagRows(rawPublished)[0]!, publishedAtPostId: `${RAW_PLUS9}#p1` },
  ]

  it('HAZARD (documented): the old payload-only diff recreates the row when B is processed before A', async () => {
    const store = fakeStore(draft, oldRows())
    await applyPayloadOnly(store, eventB)
    await applyPayloadOnly(store, eventA)
    expect(store.rows.size).toBeGreaterThan(0)
    expect(JSON.stringify(store.rowContents())).toContain('Secret draft title')
  })

  it('(f) B then A (out of order): no row and no draft title/excerpt', async () => {
    const store = fakeStore(draft, oldRows())
    await rebuild(store, eventB)
    await rebuild(store, eventA)
    expect(store.rows.size).toBe(0)
    expect(store.violations).toEqual([])
  })

  it('(f) A then B (in order): canonical rows after A, empty after B', async () => {
    const store = fakeStore(canonicalPublished, oldRows())
    await rebuild(store, eventA)
    expect([...store.rows.keys()].sort()).toEqual([`news|${CANONICAL}#p1`, `tech|${CANONICAL}#p1`])
    store.writePost(draft)
    await rebuild(store, eventB)
    expect(store.rows.size).toBe(0)
    expect(store.violations).toEqual([])
  })

  // ---------------------------------------------------------------------
  it('reads the Post strongly with the state projection and guards every Put', async () => {
    const store = fakeStore(canonicalPublished)
    const gets: Array<Record<string, unknown>> = []
    const transacts: Array<Record<string, unknown>> = []
    store.hooks.before = (info, cmd) => {
      if (info.op === 'get') gets.push(cmd.input as Record<string, unknown>)
      if (info.op === 'transact') transacts.push(cmd.input as Record<string, unknown>)
    }
    const res = await rebuild(store, eventA)
    expect(res).toMatchObject({ attempts: 1, deletes: 2, puts: 2, guardFailures: 0 })
    expect(gets).toHaveLength(2) // read + verification
    for (const g of gets) {
      expect(g).toMatchObject({
        TableName: 'posts',
        Key: { postId: 'p1' },
        ConsistentRead: true,
        ...POST_STATE_PROJECTION,
      })
    }
    expect(transacts).toHaveLength(2)
    for (const t of transacts) {
      const [check, put] = t.TransactItems as Array<Record<string, Record<string, unknown>>>
      expect(check!.ConditionCheck).toMatchObject({ TableName: 'posts', Key: { postId: 'p1' } })
      expect(put!.Put).toMatchObject({ TableName: 'tags' })
    }
  })

  it('removes rows a previous attempt wrote when the post changes mid-rebuild', async () => {
    const a = published({ tags: ['news'], title: 'A' })
    const store = fakeStore(null)
    store.writePost(a)
    store.hooks.after = (info) => {
      if (info.op === 'transact' && info.n === 1) {
        store.writePost(published({ tags: ['life'], title: 'B', publishedAt: '2026-06-01T00:00:00.000Z' }))
      }
    }
    // Candidates do not mention `news`: only the loop's own tracking can
    // remove the row it wrote for `a`.
    const res = await rebuild(store, null)
    expect(res.attempts).toBe(2)
    expect([...store.rows.keys()]).toEqual(['life|2026-06-01T00:00:00.000Z#p1'])
    expect(store.violations).toEqual([])
  })

  it('deleted post → no rows, every candidate removed, no Put attempted', async () => {
    const store = fakeStore(null, oldRows())
    const res = await rebuild(store, { previous: rawPublished, next: null })
    expect(store.rows.size).toBe(0)
    expect(res).toMatchObject({ attempts: 1, deletes: 4, puts: 0, guardFailures: 0, rows: [] })
    expect(store.counts.transact).toBeUndefined()
  })

  it('unparseable publishedAt → no rows (logged), verbatim-keyed row removed', async () => {
    const bad = published({ publishedAt: 'not-a-date', tags: ['news'] })
    const store = fakeStore(bad, [
      { ...desiredPostTagRows(published({ tags: ['news'] }))[0]!, publishedAtPostId: 'not-a-date#p1' },
    ])
    await rebuild(store, { previous: bad, next: bad })
    expect(store.rows.size).toBe(0)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('unparseable publishedAt'))
  })

  it('a non-guard transaction error is logged and thrown (no retry here)', async () => {
    const store = fakeStore(canonicalPublished)
    store.hooks.before = (info) => {
      if (info.op === 'transact') {
        throw Object.assign(new Error('conflict'), {
          name: 'TransactionCanceledException',
          CancellationReasons: [{ Code: 'None' }, { Code: 'TransactionConflict' }],
        })
      }
    }
    await expect(rebuild(store, eventA)).rejects.toThrow('conflict')
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('guarded put failed'),
      expect.anything()
    )
  })

  it('logs one summary line per rebuild', async () => {
    const lines: string[] = []
    const store = fakeStore(canonicalPublished)
    await reconcilePostTagsForPost({
      client: store.client,
      postTable: 'posts',
      postTagTable: 'tags',
      postId: 'p1',
      candidates: candidateKeys(eventA),
      log: (l) => lines.push(l),
    })
    expect(lines).toEqual([
      '[posttag-sync] postId=p1 attempts=1 deletes=2 puts=2 guardFailures=0',
    ])
  })

  it('beforeWrite is awaited immediately before every write call, writes one at a time', async () => {
    const store = fakeStore(canonicalPublished, oldRows())
    const events: string[] = []
    let inFlight = 0
    store.hooks.before = (info) => {
      if (info.op !== 'get') {
        events.push(`send:${info.op}`)
        inFlight++
        expect(inFlight).toBe(1)
      }
    }
    store.hooks.after = (info) => {
      if (info.op !== 'get') inFlight--
    }
    await rebuild(store, eventA, {
      beforeWrite: async () => {
        events.push('acquire')
      },
    })
    expect(events.length).toBeGreaterThan(0)
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]).toBe('acquire')
      expect(events[i + 1]).toMatch(/^send:/)
    }
  })
})

// ---------------------------------------------------------------------------
// (d) Two concurrent workers + an editor, interleaved at every call boundary
// ---------------------------------------------------------------------------

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

async function runSchedule(seed: number, sequence: Item[], crashBudget: number) {
  const random = rng(seed)
  const store = fakeStore(null)
  const waiting: Array<{ actor: string; resolve: () => void }> = []
  const gate = (actor: string) =>
    new Promise<void>((resolve) => waiting.push({ actor, resolve }))
  let crashes = 0
  store.hooks.before = async (info) => {
    if (info.actor === 'editor') return
    await gate(info.actor)
    if (crashes < crashBudget && random() < 0.04) {
      crashes++
      throw new Crash(`before ${info.op}`)
    }
  }
  store.hooks.after = (info) => {
    if (crashes < crashBudget && random() < 0.04) {
      crashes++
      throw new Crash(`after ${info.op}`)
    }
  }

  const queue: PostIndexEventPayload[] = []
  let editorDone = false
  let inFlight = 0
  let guardFailures = 0
  const errors: unknown[] = []

  async function editor() {
    for (const state of sequence) {
      await gate('editor')
      queue.push(store.writePost(state))
    }
    editorDone = true
  }

  async function worker(name: string) {
    const client = store.clientFor(name)
    for (;;) {
      await gate(name)
      if (queue.length === 0) {
        if (editorDone && inFlight === 0) return
        continue
      }
      // SQS standard: any message may be delivered next.
      const [event] = queue.splice(Math.floor(random() * queue.length), 1)
      inFlight++
      try {
        guardFailures += (await rebuild(store, event!, { client })).guardFailures
      } catch (err) {
        const msg = (err as Error).message
        if (!/injected crash|did not converge/.test(msg)) errors.push(err)
        queue.push(event!) // visibility timeout → redelivery
      } finally {
        inFlight--
      }
    }
  }

  const actors = [editor(), worker('w1'), worker('w2')]
  let finished = 0
  for (const a of actors) {
    a.then(
      () => finished++,
      (err) => {
        finished++
        errors.push(err)
      }
    )
  }
  for (let step = 0; ; step++) {
    await flush()
    if (finished === actors.length) break
    if (waiting.length === 0) throw new Error(`seed ${seed}: deadlock`)
    if (step > 50_000) throw new Error(`seed ${seed}: did not finish`)
    const [next] = waiting.splice(Math.floor(random() * waiting.length), 1)
    next!.resolve()
  }
  return { store, errors, crashes, guardFailures }
}

describe('(d) concurrent workers, seeded random interleavings', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const base = published({ tags: ['news', 'tech'], title: 'T0' })
  const sequences: Item[][] = [
    // published → draft → published (new tags / title) → draft
    [
      base,
      { ...base, status: 'draft', title: 'Secret 1' },
      { ...base, tags: ['tech', 'life'], title: 'T2' },
      { ...base, status: 'draft', title: 'Secret 3', excerpt: 'Secret excerpt' },
    ],
    // tag reorder, publishedAt move, unpublish, republish with other tags
    [
      base,
      { ...base, tags: ['tech', 'news'], title: 'T1' },
      { ...base, tags: ['tech'], publishedAt: '2026-06-01T09:00:00+09:00', title: 'T2' },
      { ...base, status: 'draft', title: 'Secret 3' },
      { ...base, tags: ['life', 'news'], excerpt: undefined, title: 'T4' },
    ],
    // ends published; deleted in the middle
    [
      base,
      { ...base, status: 'draft', title: 'Secret 1' },
      null as unknown as Item,
      { ...base, tags: ['news'], title: 'T3' },
    ],
  ]

  it('final rows == rows(final state) and no row is ever committed for a non-current state (≥200 schedules)', async () => {
    let schedules = 0
    let totalCrashes = 0
    let totalGuardFailures = 0
    for (const [si, sequence] of sequences.entries()) {
      for (let seed = 1; seed <= 80; seed++) {
        const { store, errors, crashes, guardFailures } = await runSchedule(
          seed * 7919 + si,
          sequence,
          seed % 2 ? 3 : 0
        )
        totalCrashes += crashes
        totalGuardFailures += guardFailures
        schedules++
        expect(errors, `seq ${si} seed ${seed}`).toEqual([])
        expect(store.violations, `seq ${si} seed ${seed}`).toEqual([])
        const want = store.currentRows().sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
        expect(store.rowContents(), `seq ${si} seed ${seed}`).toEqual(want)
      }
    }
    expect(schedules).toBeGreaterThanOrEqual(200)
    // The schedules really race: crashes were injected and guards fired.
    expect(totalCrashes).toBeGreaterThan(0)
    expect(totalGuardFailures).toBeGreaterThan(0)
  }, 60_000)
})
