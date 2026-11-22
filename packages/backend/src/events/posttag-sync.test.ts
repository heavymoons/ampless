import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { ContentEventPayload, PostIndexEventPayload } from 'ampless'
import {
  candidateKeys,
  computePostTagDiff,
  desiredPostTagRows,
  planPostTagRebuild,
  postTagRowsFingerprint,
  reconcilePostTagsForPost,
  stableStringify,
  type PostTagItem,
  type PostTagSyncClient,
} from './posttag-sync.js'

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

/**
 * In-memory Post + PostTag tables behind a fake DocumentClient. GetItem on
 * the Post table returns the current row (or the next value of a scripted
 * sequence, to simulate edits landing between the rebuild's reads).
 */
function fakeStore(initialPost: object | null) {
  let post = initialPost ? { ...initialPost } : null
  const scriptedReads: Array<object | null> = []
  const postTags = new Map<string, PostTagItem>()
  const gets: Array<Record<string, unknown>> = []
  const client: PostTagSyncClient = {
    async send(command) {
      if (command instanceof GetCommand) {
        gets.push(command.input as Record<string, unknown>)
        if (scriptedReads.length > 0) post = scriptedReads.shift() ?? null
        return post ? { Item: { ...post } } : {}
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as unknown as PostTagItem
        postTags.set(`${item.tag}|${item.publishedAtPostId}`, structuredClone(item))
        return {}
      }
      if (command instanceof DeleteCommand) {
        const key = command.input.Key as { tag: string; publishedAtPostId: string }
        postTags.delete(`${key.tag}|${key.publishedAtPostId}`)
        return {}
      }
      throw new Error('unexpected command')
    },
  }
  return {
    client,
    postTags,
    gets,
    setPost(next: object | null) {
      post = next ? { ...next } : null
    },
    /** Each subsequent GetItem first replaces the Post with the next entry. */
    scriptReads(...states: Array<object | null>) {
      scriptedReads.push(...states)
    },
    seed(rows: PostTagItem[]) {
      for (const r of rows) postTags.set(`${r.tag}|${r.publishedAtPostId}`, structuredClone(r))
    },
  }
}

const RAW_PLUS9 = '2026-05-01T09:00:00+09:00'
const CANONICAL = '2026-05-01T00:00:00.000Z'

/** Apply a payload the old way (payload-only diff), against the fake store. */
async function applyPayloadOnly(
  store: ReturnType<typeof fakeStore>,
  payload: PostIndexEventPayload
): Promise<void> {
  const { deletes, puts } = computePostTagDiff(payload)
  for (const key of deletes) {
    await store.client.send(new DeleteCommand({ TableName: 'tags', Key: key }))
  }
  for (const item of puts) {
    await store.client.send(new PutCommand({ TableName: 'tags', Item: item }))
  }
}

describe('reconcilePostTagsForPost', () => {
  const silent = () => {}
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function run(
    store: ReturnType<typeof fakeStore>,
    payload: PostIndexEventPayload | null,
    extra = []
  ) {
    return reconcilePostTagsForPost({
      client: store.client,
      postTable: 'posts',
      postTagTable: 'tags',
      postId: 'p1',
      candidates: candidateKeys(payload, extra),
      log: silent,
    })
  }

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
  // Rows written for the raw state by the current (canonical-keying) logic,
  // plus a legacy verbatim-keyed row from before canonicalization.
  const oldRows = (): PostTagItem[] => [
    ...desiredPostTagRows(rawPublished),
    { ...desiredPostTagRows(rawPublished)[0]!, publishedAtPostId: `${RAW_PLUS9}#p1` },
  ]

  it('HAZARD (documented): the old payload-only diff recreates the row when B is processed before A', async () => {
    const store = fakeStore(draft)
    store.seed(oldRows())
    await applyPayloadOnly(store, eventB)
    await applyPayloadOnly(store, eventA)
    // A's `next` (published) is written although the post is now a draft.
    expect(store.postTags.size).toBeGreaterThan(0)
    expect(JSON.stringify([...store.postTags.values()])).toContain('Secret draft title')
  })

  it('B then A (out of order): the rebuild leaves no row and exposes no draft title/excerpt', async () => {
    const store = fakeStore(draft)
    store.seed(oldRows())
    await run(store, eventB)
    await run(store, eventA)
    expect(store.postTags.size).toBe(0)
    const dump = JSON.stringify([...store.postTags.values()])
    expect(dump).not.toContain('Secret draft title')
    expect(dump).not.toContain('Secret draft excerpt')
  })

  it('A then B (in order): also ends empty', async () => {
    const store = fakeStore(canonicalPublished)
    store.seed(oldRows())
    await run(store, eventA)
    // After A, exactly the canonical rows of the published state.
    expect([...store.postTags.keys()].sort()).toEqual([
      `news|${CANONICAL}#p1`,
      `tech|${CANONICAL}#p1`,
    ])
    store.setPost(draft)
    await run(store, eventB)
    expect(store.postTags.size).toBe(0)
  })

  it('reads the Post strongly with the payload projection', async () => {
    const store = fakeStore(canonicalPublished)
    await run(store, eventA)
    expect(store.gets[0]).toMatchObject({
      TableName: 'posts',
      Key: { postId: 'p1' },
      ConsistentRead: true,
      ProjectionExpression:
        '#postId, #slug, #title, #status, #format, #excerpt, #publishedAt, #tags',
      ExpressionAttributeNames: expect.objectContaining({ '#status': 'status', '#tags': 'tags' }),
    })
    // Initial read + one verification read.
    expect(store.gets).toHaveLength(2)
    expect(store.gets.every((g) => g.ConsistentRead === true)).toBe(true)
  })

  it('state changes between read and write → loops and ends with the new state (empty)', async () => {
    const store = fakeStore(null)
    store.seed(oldRows())
    // First read: published; verification read: draft; next verification: draft.
    store.scriptReads(canonicalPublished, draft, draft)
    const res = await run(store, eventA)
    expect(res.attempts).toBe(2)
    expect(store.postTags.size).toBe(0)
    expect(store.gets).toHaveLength(3)
  })

  it('two edits changing tags / title: both orders leave only the final state rows', async () => {
    const s0 = published({ tags: ['news'], title: 'T0' })
    const s1 = published({ tags: ['news', 'tech'], title: 'T1' })
    const s2 = published({ tags: ['tech', 'life'], title: 'T2' })
    const e1: PostIndexEventPayload = { previous: s0, next: s1 }
    const e2: PostIndexEventPayload = { previous: s1, next: s2 }
    const expected = postTagRowsFingerprint(desiredPostTagRows(s2))

    for (const order of [
      [e1, e2],
      [e2, e1],
    ]) {
      const store = fakeStore(s2)
      store.seed(desiredPostTagRows(s0))
      for (const e of order) await run(store, e)
      expect(postTagRowsFingerprint([...store.postTags.values()])).toBe(expected)
      expect(JSON.stringify([...store.postTags.values()])).not.toMatch(/"T0"|"T1"/)
    }
  })

  it('removes rows a previous attempt wrote when the post changes mid-rebuild', async () => {
    const a = published({ tags: ['news'], title: 'A' })
    const b = published({ tags: ['life'], title: 'B', publishedAt: '2026-06-01T00:00:00.000Z' })
    const store = fakeStore(null)
    store.scriptReads(a, b, b)
    // Candidates do not mention `news` at all: only the loop's own tracking
    // can remove the row it wrote for `a`.
    const res = await run(store, null)
    expect(res.attempts).toBe(2)
    expect([...store.postTags.keys()]).toEqual(['life|2026-06-01T00:00:00.000Z#p1'])
  })

  it('throws (and logs) when the state does not settle within 5 attempts', async () => {
    const store = fakeStore(null)
    const states = Array.from({ length: 6 }, (_, i) => published({ title: `T${i}` }))
    store.scriptReads(...states)
    await expect(run(store, eventA)).rejects.toThrow(/did not converge after 5 attempts/)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('did not converge'))
    expect(store.gets).toHaveLength(6)
  })

  it('deleted post → desired empty, every candidate removed', async () => {
    const store = fakeStore(null)
    store.seed(oldRows())
    const res = await run(store, { previous: rawPublished, next: null })
    expect(store.postTags.size).toBe(0)
    // 2 tags x (canonical + verbatim) deletes, some of them no-ops.
    expect(res).toMatchObject({ attempts: 1, removed: 4, upserted: 0, rows: [] })
  })

  it('unparseable publishedAt → no rows (logged), verbatim-keyed row removed', async () => {
    const bad = published({ publishedAt: 'not-a-date', tags: ['news'] })
    const store = fakeStore(bad)
    store.seed([
      {
        ...desiredPostTagRows(published({ tags: ['news'] }))[0]!,
        publishedAtPostId: 'not-a-date#p1',
      },
    ])
    await run(store, { previous: bad, next: bad })
    expect(store.postTags.size).toBe(0)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('unparseable publishedAt'))
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
    expect(lines).toEqual(['[posttag-sync] postId=p1 attempts=1 removed=2 upserted=2'])
  })
})
