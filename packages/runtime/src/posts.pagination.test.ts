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

import { createPostsApi } from './posts.js'
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
