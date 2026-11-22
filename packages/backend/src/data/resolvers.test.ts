// Unit tests for the bundled AppSync JS resolvers in
// templates/_shared/amplify/data/.
//
// Scope (#389 / #404 / #409): only `get-published-post` decides visibility
// by instant. `list-published-posts` / `list-posts-by-tag` are deliberately
// the pre-#404 lexical resolvers (a response-side instant filter made pages
// short or empty and every runtime fill strategy regressed valid data); the
// list-side gaps are pinned below as KNOWN GAP (#406) tests. `@aws-appsync/utils` only exists inside
// the AppSync runtime, so it is replaced by a small fake whose `util.time`
// mirrors the real behaviour verified with `aws appsync evaluate-code`:
// parseISO8601ToEpochMilliSeconds handles offsets and returns undefined for
// unparseable input; epochMilliSecondsToFormatted with the canonical pattern
// yields fixed-width UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
        // Both patterns verified with `aws appsync evaluate-code`.
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

interface Ctx {
  args: Record<string, unknown>
  stash: Record<string, unknown>
  result?: { items?: unknown[]; nextToken?: string | null }
  error?: { message: string; type: string }
}

interface ResolverModule {
  request: (ctx: Ctx) => unknown
  response: (ctx: Ctx) => unknown
}

// The resolvers are plain JS with no type declarations; type them here.
const getPublishedPost = (await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../../templates/_shared/amplify/data/get-published-post.js'
)) as ResolverModule
const listPublishedPosts = (await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../../templates/_shared/amplify/data/list-published-posts.js'
)) as ResolverModule
const listPostsByTag = (await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../../templates/_shared/amplify/data/list-posts-by-tag.js'
)) as ResolverModule

const NOW = '2026-01-01T03:00:00.000Z'

function ctx(args: Record<string, unknown> = {}): Ctx {
  return { args, stash: {} }
}

function post(publishedAt: string | undefined, extra: Record<string, unknown> = {}) {
  return {
    postId: `p-${publishedAt}`,
    slug: `s-${publishedAt}`,
    title: 't',
    status: 'published',
    publishedAt,
    ...extra,
  }
}

function tagRow(publishedAt: string, postId = `p-${publishedAt}`) {
  return {
    tag: 'news',
    publishedAtPostId: `${publishedAt}#${postId}`,
    postId,
    slug: `s-${postId}`,
    title: 't',
    publishedAt,
    tags: ['news'],
  }
}

function getVisible(publishedAt: string | undefined): boolean {
  const c = ctx({ slug: 'x' })
  getPublishedPost.request(c)
  c.result = { items: [post(publishedAt)] }
  return getPublishedPost.response(c) !== null
}

/**
 * Apply the resolver's key condition to `rows` the way DynamoDB would: the
 * sort key is compared as a string, rows come back in SK order (descending,
 * as both list resolvers request), then the response runs.
 */
function runQuery(
  mod: ResolverModule,
  args: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
  skAttr: string
) {
  const c = ctx(args)
  const req = mod.request(c) as Record<string | symbol, unknown>
  if (req[EARLY_RETURN]) return { req, items: [] as Array<Record<string, unknown>> }
  const query = req.query as { expression: string; expressionValues: Record<string, string> }
  const upper = query.expressionValues[':upper']!
  const from = query.expressionValues[':from']
  const hit = rows
    .filter((r) => {
      const sk = String(r[skAttr])
      return sk <= upper && (from === undefined || sk >= from)
    })
    .sort((a, b) => (String(a[skAttr]) < String(b[skAttr]) ? 1 : -1))
    .slice(0, (req.limit as number | undefined) ?? 20)
  c.result = { items: hit, nextToken: null }
  const res = mod.response(c) as { items: Array<Record<string, unknown>> }
  return { req, items: res.items }
}

beforeEach(() => {
  nowMs = Date.parse(NOW)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getPublishedPost decides visibility by instant', () => {
  it.each([
    // [publishedAt, visible at NOW]
    ['2026-01-01T02:59:59.999Z', true], // canonical past
    ['2026-01-01T03:00:00.000Z', true], // exactly now (boundary counts as live)
    ['2026-01-01T03:00:00.001Z', false], // canonical future
    ['2026-01-01T12:00:00+09:00', true], // = 03:00Z exactly
    ['2026-01-01T12:00:00.001+09:00', false], // 1ms after now
    ['2026-01-01T11:00:00+09:00', true], // = 02:00Z (lexically "future": was hidden)
    ['2025-12-31T22:00:00-05:00', true], // = 03:00Z exactly
    ['2025-12-31T23:00:00-05:00', false], // = 04:00Z: lexically "past" (was exposed early)
    ['2026-01-01T03:00Z', true], // no seconds, = now
    ['2026-01-01T03:00:00Z', true], // no millis, = now
    ['not-a-date', false], // unparseable fails closed
  ])('%s → visible=%s', (publishedAt, visible) => {
    expect(getVisible(publishedAt)).toBe(visible)
  })

  it('treats a missing publishedAt as immediately published', () => {
    expect(getVisible(undefined)).toBe(true)
  })

  it('ignores drafts', () => {
    const c = ctx({ slug: 'x' })
    getPublishedPost.request(c)
    c.result = { items: [post(NOW, { status: 'draft' })] }
    expect(getPublishedPost.response(c)).toBeNull()
  })
})

describe('list resolvers keep the pre-#404 behaviour (no response-side filter)', () => {
  it('listPublishedPosts: upper bound is nowISO8601, raw from/to are used verbatim', () => {
    const { req } = runQuery(
      listPublishedPosts,
      { from: '2026-01-01T01:00:00+09:00', to: '2026-01-01T02:00:00.000Z' },
      [],
      'publishedAt'
    )
    const query = req.query as { expression: string; expressionValues: Record<string, string> }
    expect(query.expression).toBe('#status = :status AND #publishedAt BETWEEN :from AND :upper')
    expect(query.expressionValues[':from']).toBe('2026-01-01T01:00:00+09:00')
    expect(query.expressionValues[':upper']).toBe('2026-01-01T02:00:00.000Z')
  })

  it('listPublishedPosts: returns every row DynamoDB returns, so a page is never shortened', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      post(new Date(Date.parse(NOW) - (i + 1) * 60_000).toISOString())
    )
    const { items } = runQuery(listPublishedPosts, { limit: 6 }, rows, 'publishedAt')
    expect(items).toHaveLength(6)
  })

  it('listPostsByTag: upper bound is the now string followed by the U+FFFF sentinel', () => {
    const { req } = runQuery(listPostsByTag, { tag: 'news' }, [], 'publishedAtPostId')
    const query = req.query as { expressionValues: Record<string, string> }
    expect(query.expressionValues[':upper']).toBe(`${NOW}#￿`)
  })
})

describe('tag listing with canonical PostTag keys (posttag-sync)', () => {
  async function tagRowsFor(publishedAt: string, postId: string) {
    const { computePostTagDiff } = await import('../events/posttag-sync.js')
    return computePostTagDiff({
      previous: null,
      next: { postId, slug: postId, title: 't', status: 'published', publishedAt, tags: ['news'] },
    } as never).puts as unknown as Array<Record<string, unknown>>
  }

  it('a new live +09:00 post is listed (its row is keyed in canonical UTC)', async () => {
    const rows = await tagRowsFor('2026-01-01T11:00:00+09:00', 'p1') // = 02:00Z
    const { items } = runQuery(listPostsByTag, { tag: 'news' }, rows, 'publishedAtPostId')
    expect(items.map((i) => i.postId)).toEqual(['p1'])
  })

  it('a new future -05:00 post is not exposed early (its canonical key is in the future)', async () => {
    const rows = await tagRowsFor('2025-12-31T23:00:00-05:00', 'p2') // = 04:00Z
    const { items } = runQuery(listPostsByTag, { tag: 'news' }, rows, 'publishedAtPostId')
    expect(items).toEqual([])
  })
})

describe('KNOWN GAP (#406): list resolvers compare the stored string', () => {
  it('listPublishedPosts exposes a future -05:00 Post row early (sorts before now as a string)', () => {
    const { items } = runQuery(
      listPublishedPosts,
      {},
      [post('2025-12-31T23:00:00-05:00')],
      'publishedAt'
    )
    expect(items).toHaveLength(1)
  })

  it('listPublishedPosts omits an already-live +09:00 Post row until its local time passes', () => {
    const { items } = runQuery(
      listPublishedPosts,
      {},
      [post('2026-01-01T11:00:00+09:00')],
      'publishedAt'
    )
    expect(items).toEqual([])
  })

  it('listPublishedPosts orders mixed-offset rows by string, not instant', () => {
    const plus9 = post('2026-01-01T00:30:00+09:00') // = 2025-12-31T15:30Z
    const utc = post('2025-12-31T20:00:00.000Z')
    const { items } = runQuery(listPublishedPosts, {}, [utc, plus9], 'publishedAt')
    expect(items.map((i) => i.publishedAt)).toEqual([plus9.publishedAt, utc.publishedAt])
  })

  it('listPostsByTag exposes a legacy verbatim-keyed future -05:00 PostTag row until the post is re-saved', () => {
    const { items } = runQuery(
      listPostsByTag,
      { tag: 'news' },
      [tagRow('2025-12-31T23:00:00-05:00')],
      'publishedAtPostId'
    )
    expect(items).toHaveLength(1)
  })
})
