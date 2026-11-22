// End-to-end pagination: the REAL bundled AppSync resolvers
// (templates/_shared/amplify/data/) run against a fake DynamoDB Query that
// behaves like the real one where it matters here:
//   - the key condition is evaluated on the sort key as a STRING,
//   - rows come back in SK-descending order (scanIndexForward: false),
//   - `limit` is applied BEFORE the resolver's response handler runs,
//   - `nextToken` is an opaque cursor that resumes after the last row read.
// createPostsApi is wired to those resolvers through the mocked Amplify
// client, so these tests show what the official runtime (home / tag pages)
// actually returns.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAwsDateTime } from 'ampless'

const EARLY_RETURN = Symbol('earlyReturn')
let nowMs = 0

vi.mock('@aws-appsync/utils', () => ({
  util: {
    time: {
      nowEpochMilliSeconds: () => nowMs,
      nowISO8601: () => new Date(nowMs).toISOString(),
      parseISO8601ToEpochMilliSeconds: (s: string) => parseAwsDateTime(s),
      epochMilliSecondsToFormatted: (ms: number, format: string, zone: string) => {
        if (zone !== 'UTC') throw new Error(`unexpected zone ${zone}`)
        const iso = new Date(ms).toISOString()
        if (format === "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") return iso
        if (format === "yyyy-MM-dd'T'HH:mm") return iso.slice(0, 16)
        throw new Error(`unexpected format ${format}`)
      },
    },
    dynamodb: { toMapValues: (v: Record<string, unknown>) => v },
    error: (message: string) => {
      throw new Error(message)
    },
  },
  runtime: {
    earlyReturn: (value: unknown) => ({ [EARLY_RETURN]: true, value }),
  },
}))

vi.mock('@aws-amplify/adapter-nextjs', () => ({
  createServerRunner: () => ({
    runWithAmplifyServerContext: ({ operation }: { operation: (ctx: unknown) => unknown }) =>
      operation({}),
  }),
}))

type Row = Record<string, unknown>

interface ResolverModule {
  request: (ctx: Ctx) => unknown
  response: (ctx: Ctx) => unknown
}

interface Ctx {
  args: Record<string, unknown>
  stash: Record<string, unknown>
  result?: { items: Row[]; nextToken: string | null }
}

const listPublishedPosts = (await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../templates/_shared/amplify/data/list-published-posts.js'
)) as ResolverModule
const listPostsByTag = (await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../templates/_shared/amplify/data/list-posts-by-tag.js'
)) as ResolverModule

/** Tables the fake DynamoDB serves, keyed by resolver. */
let byStatusRows: Row[] = []
let postTagRows: Row[] = []
/** Every resolver invocation, for call-count assertions. */
const calls: Array<{ resolver: string; args: Record<string, unknown> }> = []

/** A DynamoDB-like Query: lexical key condition, SK desc, limit, cursor. */
function fakeQuery(
  req: Row,
  rows: Row[],
  skAttr: string
): { items: Row[]; nextToken: string | null } {
  const query = req.query as { expressionValues: Record<string, string> }
  const upper = query.expressionValues[':upper']!
  const from = query.expressionValues[':from']
  const tag = query.expressionValues[':tag']
  const matching = rows
    .filter((r) => (tag === undefined ? true : r.tag === tag))
    .filter((r) => {
      const sk = String(r[skAttr])
      return sk <= upper && (from === undefined || sk >= from)
    })
    .sort((a, b) => (String(a[skAttr]) < String(b[skAttr]) ? 1 : -1))
  const after = req.nextToken === undefined ? undefined : String(req.nextToken)
  const remaining =
    after === undefined ? matching : matching.filter((r) => String(r[skAttr]) < after)
  const limit = req.limit as number
  const page = remaining.slice(0, limit)
  const more = remaining.length > page.length
  return { items: page, nextToken: more ? String(page[page.length - 1]![skAttr]) : null }
}

/** Run one AppSync invocation of `mod`: request → fake DynamoDB → response. */
function invoke(name: string, mod: ResolverModule, args: Record<string, unknown>) {
  calls.push({ resolver: name, args })
  const ctx: Ctx = { args, stash: {} }
  const req = mod.request(ctx) as Record<string | symbol, unknown>
  if (req[EARLY_RETURN]) return req.value as { items: Row[]; nextToken: string | null }
  ctx.result =
    name === 'listPostsByTag'
      ? fakeQuery(req, postTagRows, 'publishedAtPostId')
      : fakeQuery(req, byStatusRows, 'publishedAt')
  return mod.response(ctx) as { items: Row[]; nextToken: string | null }
}

vi.mock('@aws-amplify/adapter-nextjs/api', () => ({
  generateServerClientUsingReqRes: () => ({
    queries: {
      listPublishedPosts: async (_ctx: unknown, args: Record<string, unknown>) => ({
        data: invoke('listPublishedPosts', listPublishedPosts, args),
        errors: null,
      }),
      listPostsByTag: async (_ctx: unknown, args: Record<string, unknown>) => ({
        data: invoke('listPostsByTag', listPostsByTag, args),
        errors: null,
      }),
      getPublishedPost: async () => ({ data: null, errors: null }),
    },
  }),
}))

import { createPostsApi, PostListScanLimitError } from './posts.js'
import type { AmplessOutputs } from './outputs.js'

const NOW = '2026-01-01T03:00:00.000Z'

function post(id: string, publishedAt: string): Row {
  return {
    postId: id,
    slug: id,
    title: id,
    format: 'markdown',
    status: 'published',
    publishedAt,
    tags: ['news'],
  }
}

function tagRow(id: string, publishedAt: string): Row {
  return { ...post(id, publishedAt), tag: 'news', publishedAtPostId: `${publishedAt}#${id}` }
}

/** `count` canonical live rows, newest first, one hour apart before NOW. */
function liveCanonical(count: number): Array<{ id: string; at: string }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `live-${String(i).padStart(2, '0')}`,
    at: new Date(Date.parse(NOW) - (i + 1) * 3_600_000).toISOString(),
  }))
}

/**
 * Six future rows written through the API with a -05:00 offset. As strings
 * they sort just below NOW (02:5x), so they are the FIRST six rows the key
 * condition returns, but their instants are 07:5xZ — not yet live.
 */
const FUTURE_MINUS5 = [50, 51, 52, 53, 54, 55].map((m) => ({
  id: `future-${m}`,
  at: `2026-01-01T02:${m}:00-05:00`,
}))

/** Follow nextToken through the runtime API and return every page. */
async function allPages(
  fetch: (
    nextToken?: string
  ) => Promise<{ items: Array<{ postId: string }>; nextToken: string | null }>
): Promise<string[][]> {
  const pages: string[][] = []
  let token: string | undefined
  do {
    const res = await fetch(token)
    pages.push(res.items.map((p) => p.postId))
    token = res.nextToken ?? undefined
  } while (token)
  return pages
}

const api = () => createPostsApi({} as unknown as AmplessOutputs)

beforeEach(() => {
  nowMs = Date.parse(NOW)
  calls.length = 0
  byStatusRows = []
  postTagRows = []
})

describe('listPublishedPosts pagination (resolver + DynamoDB limit semantics)', () => {
  it('fills the first page even when the first index rows are future negative-offset posts', async () => {
    const live = liveCanonical(10)
    byStatusRows = [
      post('future-canonical', '2026-01-01T04:00:00.000Z'), // excluded by the key bound
      ...FUTURE_MINUS5.map((r) => post(r.id, r.at)),
      ...live.map((r) => post(r.id, r.at)),
    ]

    // The raw resolver (one AppSync call) is short: DynamoDB returned the six
    // future rows, the response dropped them, and nextToken is still set.
    // That is a valid connection page, but a caller reading only the first
    // page would show nothing.
    const raw = invoke('listPublishedPosts', listPublishedPosts, { limit: 6 })
    expect(raw.items).toEqual([])
    expect(raw.nextToken).not.toBeNull()

    // The runtime keeps following nextToken until the page is full.
    calls.length = 0
    const first = await api().listPublishedPosts({ limit: 6 })
    expect(first.items.map((p) => p.postId)).toEqual(live.slice(0, 6).map((r) => r.id))
    expect(first.nextToken).not.toBeNull()
    expect(calls).toHaveLength(2)

    // Following pages: every live post exactly once, in order, none future.
    const pages = await allPages((nextToken) => api().listPublishedPosts({ limit: 6, nextToken }))
    expect(pages.flat()).toEqual(live.map((r) => r.id))
    expect(pages.map((p) => p.length)).toEqual([6, 4])
  })

  it('canonical data: same pages as before, one resolver call per page', async () => {
    const live = liveCanonical(13)
    byStatusRows = [
      post('future-canonical', '2026-01-01T04:00:00.000Z'),
      ...live.map((r) => post(r.id, r.at)),
    ]

    const pages = await allPages((nextToken) => api().listPublishedPosts({ limit: 5, nextToken }))

    expect(pages).toEqual([
      live.slice(0, 5).map((r) => r.id),
      live.slice(5, 10).map((r) => r.id),
      live.slice(10).map((r) => r.id),
    ])
    expect(calls).toHaveLength(3)
  })

  it('a `to` bound keeps an equal instant spelled without milliseconds', async () => {
    byStatusRows = [
      post('later', '2026-01-01T01:00:30.000Z'), // same minute, after `to`: read, then dropped
      post('equal-no-ms', '2026-01-01T01:00:00Z'),
      post('earlier', '2026-01-01T00:59:00.000Z'),
    ]

    const res = await api().listPublishedPosts({ to: '2026-01-01T01:00:00.000Z' })

    expect(res.items.map((p) => p.postId)).toEqual(['equal-no-ms', 'earlier'])
  })
})

describe('listPostsByTag pagination with legacy verbatim-keyed rows', () => {
  it('fills the first page past legacy future negative-offset PostTag rows', async () => {
    const live = liveCanonical(8)
    postTagRows = [
      ...FUTURE_MINUS5.map((r) => tagRow(r.id, r.at)),
      ...live.map((r) => tagRow(r.id, r.at)),
      { ...tagRow('other-tag', live[0]!.at), tag: 'other' },
    ]

    const raw = invoke('listPostsByTag', listPostsByTag, { tag: 'news', limit: 6 })
    expect(raw.items).toEqual([])
    expect(raw.nextToken).not.toBeNull()

    const pages = await allPages((nextToken) =>
      api().listPostsByTag('news', { limit: 6, nextToken })
    )
    expect(pages[0]).toEqual(live.slice(0, 6).map((r) => r.id))
    expect(pages.flat()).toEqual(live.map((r) => r.id))
  })

  it('canonical PostTag rows: one resolver call per page', async () => {
    const live = liveCanonical(7)
    postTagRows = live.map((r) => tagRow(r.id, r.at))

    const pages = await allPages((nextToken) =>
      api().listPostsByTag('news', { limit: 4, nextToken })
    )

    expect(pages).toEqual([live.slice(0, 4).map((r) => r.id), live.slice(4).map((r) => r.id)])
    expect(calls).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Many dropped rows: chunked fill and the explicit scan limit
// ---------------------------------------------------------------------------

/**
 * `count` future rows written through the API with a -05:00 offset, at
 * 2-minute steps from local 01:00 upward. As strings they sort below NOW
 * (03:00Z), so the key condition returns them, but their instants are
 * 06:00Z+ — not yet live — so the resolver drops every one of them.
 */
function futureMinus5(count: number, stepSeconds = 120, startLocal = '2026-01-01T01:00:00'): Row[] {
  const base = Date.parse(`${startLocal}Z`)
  return Array.from({ length: count }, (_, i) => {
    const local = new Date(base + i * stepSeconds * 1000).toISOString().slice(0, 19)
    return post(`future-${String(i).padStart(4, '0')}`, `${local}-05:00`)
  })
}

describe('first page past many future negative-offset rows (reviewer reproduction)', () => {
  // 60 future -05:00 rows ahead of (and interleaved with) 30 live posts.
  const live = liveCanonical(30)
  const liveIds = live.map((r) => r.id)
  const seed = () => {
    byStatusRows = [...futureMinus5(60), ...live.map((r) => post(r.id, r.at))]
  }

  it('the raw resolver page is empty with a nextToken (what a first-page-only view would see)', () => {
    seed()
    const raw = invoke('listPublishedPosts', listPublishedPosts, { limit: 6 })
    expect(raw.items).toEqual([])
    expect(raw.nextToken).not.toBeNull()
  })

  it('landing home (limit 6) gets the 6 newest live posts in 2 resolver calls', async () => {
    seed()
    const res = await api().listPublishedPosts({ limit: 6 })
    expect(res.items.map((p) => p.postId)).toEqual(liveIds.slice(0, 6))
    expect(res.nextToken).not.toBeNull()
    // Fast path (limit 6) + one chunk of 100.
    expect(calls.map((c) => c.args.limit)).toEqual([6, 100])
  })

  it.each([
    ['blog / minimal (default 20)', undefined, 20],
    ['corporate', 8, 8],
    ['dads', 10, 10],
    ['docs', 12, 12],
  ])('%s home gets a full page of the newest live posts', async (_name, limit, expected) => {
    seed()
    const res = await api().listPublishedPosts(limit === undefined ? {} : { limit })
    expect(res.items.map((p) => p.postId)).toEqual(liveIds.slice(0, expected))
  })

  it('tag pages and the sidebar (limit 50) get every live post past 60 legacy PostTag rows', async () => {
    postTagRows = [
      ...futureMinus5(60).map((r) => tagRow(String(r.postId), String(r.publishedAt))),
      ...live.map((r) => tagRow(r.id, r.at)),
    ]
    const res = await api().listPostsByTag('news', { limit: 50 })
    expect(res.items.map((p) => p.postId)).toEqual(liveIds)
    expect(res.nextToken).toBeNull()
  })

  it.each([6, 7])(
    'limit %i: paging through returned cursors yields every live post once, in order',
    async (limit) => {
      seed()
      const tokens: string[] = []
      const pages = await allPages(async (nextToken) => {
        const res = await api().listPublishedPosts({ limit, nextToken })
        if (res.nextToken) tokens.push(res.nextToken)
        // Never a short page while the listing continues.
        if (res.nextToken) expect(res.items).toHaveLength(limit)
        return res
      })
      expect(pages.flat()).toEqual(liveIds)
      expect(pages.flat().some((id) => id.startsWith('future-'))).toBe(false)
      // At least one boundary fell inside a chunk (runtime cursor).
      expect(tokens.some((t) => t.startsWith('ampless-c1.'))).toBe(true)
    }
  )

  it('a raw AppSync token passed in still works', async () => {
    byStatusRows = live.map((r) => post(r.id, r.at))
    const raw = invoke('listPublishedPosts', listPublishedPosts, { limit: 3 })
    const res = await api().listPublishedPosts({ limit: 3, nextToken: raw.nextToken! })
    expect(res.items.map((p) => p.postId)).toEqual(liveIds.slice(3, 6))
  })

  it('canonical data: one call per page with the requested limit and raw tokens', async () => {
    byStatusRows = live.map((r) => post(r.id, r.at))
    const tokens: string[] = []
    const pages = await allPages(async (nextToken) => {
      const res = await api().listPublishedPosts({ limit: 7, nextToken })
      if (res.nextToken) tokens.push(res.nextToken)
      return res
    })
    expect(pages.flat()).toEqual(liveIds)
    expect(calls.every((c) => c.args.limit === 7)).toBe(true)
    expect(calls).toHaveLength(5)
    expect(tokens.some((t) => t.startsWith('ampless-c1.'))).toBe(false)
  })
})

describe('scan limit: more dropped rows than one page may read', () => {
  // 2,100 future -05:00 rows (local 00:00:00 upward, 2 s apart) sort below
  // NOW; the live posts are all older than every one of them.
  const live = Array.from({ length: 10 }, (_, i) => ({
    id: `old-${i}`,
    at: new Date(Date.parse('2025-12-31T20:00:00.000Z') - i * 3_600_000).toISOString(),
  }))
  const seed = () => {
    byStatusRows = [
      ...futureMinus5(2100, 2, '2026-01-01T00:00:00'),
      ...live.map((r) => post(r.id, r.at)),
    ]
  }

  it('rejects with PostListScanLimitError instead of resolving to an empty page', async () => {
    seed()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = await api()
      .listPublishedPosts({ limit: 6 })
      .then(
        () => undefined,
        (e: unknown) => e
      )
    expect(err).toBeInstanceOf(PostListScanLimitError)
    const e = err as PostListScanLimitError
    expect(e.calls).toBe(20)
    expect(e.items).toEqual([])
    expect(e.nextToken).toMatch(/^ampless-c1\./)
    expect(calls).toHaveLength(20)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()

    // The error's cursor resumes the scan and reaches the live posts.
    calls.length = 0
    const resumed = await api().listPublishedPosts({ limit: 6, nextToken: e.nextToken })
    expect(resumed.items.map((p) => p.postId)).toEqual(live.slice(0, 6).map((r) => r.id))
  })

  it('tag listing fails the same way', async () => {
    postTagRows = [
      ...futureMinus5(2100, 2, '2026-01-01T00:00:00').map((r) =>
        tagRow(String(r.postId), String(r.publishedAt))
      ),
      ...live.map((r) => tagRow(r.id, r.at)),
    ]
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(api().listPostsByTag('news', { limit: 50 })).rejects.toMatchObject({
      name: 'PostListScanLimitError',
      operation: 'listPostsByTag',
      calls: 20,
    })
    error.mockRestore()
  })
})
