// Unit tests for the bundled AppSync JS resolvers in
// templates/_shared/amplify/data/. `@aws-appsync/utils` only exists inside
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

/** Run request then response against `rows`, as AppSync would. */
function runList(mod: ResolverModule, args: Record<string, unknown>, rows: unknown[]) {
  const c = ctx(args)
  const req = mod.request(c) as Record<string, unknown>
  c.result = { items: rows, nextToken: null }
  return { req, res: mod.response(c) as { items: Array<Record<string, unknown>> } }
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

function tagRow(publishedAt: string) {
  return {
    tag: 'news',
    publishedAtPostId: `${publishedAt}#p-${publishedAt}`,
    postId: `p-${publishedAt}`,
    slug: `s-${publishedAt}`,
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

function listVisible(publishedAt: string): boolean {
  return runList(listPublishedPosts, {}, [post(publishedAt)]).res.items.length === 1
}

function tagVisible(publishedAt: string): boolean {
  return runList(listPostsByTag, { tag: 'news' }, [tagRow(publishedAt)]).res.items.length === 1
}

beforeEach(() => {
  nowMs = Date.parse(NOW)
})

afterEach(() => {
  vi.clearAllMocks()
})

// NOTE: these cases feed rows straight to the response handler, i.e. they
// assume DynamoDB already returned the row. They check the instant re-check
// only. Whether a row survives the lexical KEY condition is covered by the
// end-to-end describe at the bottom of this file, which is where the
// remaining (#389) gap for non-canonical Post rows shows up.
describe('response re-check decides visibility by instant, consistently', () => {
  it.each([
    // [publishedAt, visible at NOW]
    ['2026-01-01T02:59:59.999Z', true], // canonical past
    ['2026-01-01T03:00:00.000Z', true], // exactly now (boundary counts as live)
    ['2026-01-01T03:00:00.001Z', false], // canonical future
    ['2026-01-01T12:00:00+09:00', true], // = 03:00Z exactly
    ['2026-01-01T12:00:00.001+09:00', false], // 1ms after now
    ['2026-01-01T11:00:00+09:00', true], // = 02:00Z
    ['2025-12-31T22:00:00-05:00', true], // = 03:00Z exactly
    ['2025-12-31T23:00:00-05:00', false], // = 04:00Z: lexically "past", but future
    ['2026-01-01T03:00Z', true], // no seconds, = now
    ['2026-01-01T03:00:00Z', true], // no millis, = now
    ['not-a-date', false], // unparseable fails closed
  ])('%s → visible=%s in get / list / tag response', (publishedAt, visible) => {
    expect(getVisible(publishedAt)).toBe(visible)
    expect(listVisible(publishedAt)).toBe(visible)
    expect(tagVisible(publishedAt)).toBe(visible)
  })

  it('getPublishedPost treats a missing publishedAt as immediately published', () => {
    expect(getVisible(undefined)).toBe(true)
  })

  it('getPublishedPost ignores drafts', () => {
    const c = ctx({ slug: 'x' })
    getPublishedPost.request(c)
    c.result = { items: [post(NOW, { status: 'draft' })] }
    expect(getPublishedPost.response(c)).toBeNull()
  })
})

describe('listPublishedPosts key bounds', () => {
  it('clamps the upper bound to the canonical now string', () => {
    const { req } = runList(listPublishedPosts, {}, [])
    const query = req.query as { expression: string; expressionValues: Record<string, string> }
    expect(query.expression).toBe('#status = :status AND #publishedAt <= :upper')
    expect(query.expressionValues[':upper']).toBe(NOW)
  })

  it('widens offset from/to arguments to safe key bounds (never narrower than the raw strings)', () => {
    const { req } = runList(
      listPublishedPosts,
      { from: '2026-01-01T09:00:00+09:00', to: '2026-01-01T02:00:00+01:00' },
      []
    )
    const query = req.query as { expression: string; expressionValues: Record<string, string> }
    expect(query.expression).toBe('#status = :status AND #publishedAt BETWEEN :from AND :upper')
    // min(raw from, UTC minute floor of from)
    expect(query.expressionValues[':from']).toBe('2026-01-01T00:00')
    // max(raw to, UTC minute of to + 'Z') = raw to ('T02' > 'T01')
    expect(query.expressionValues[':upper']).toBe('2026-01-01T02:00:00+01:00')
  })

  it('never puts the upper key above the canonical now key', () => {
    // 10:00+09:00 = 01:00Z is before now, but its raw string sorts after NOW.
    const { req } = runList(listPublishedPosts, { to: '2026-01-01T10:00:00+09:00' }, [])
    const query = req.query as { expressionValues: Record<string, string> }
    expect(query.expressionValues[':upper']).toBe(NOW)
  })

  it('uses `<minute>Z` as the upper key for a canonical `to`', () => {
    const { req } = runList(listPublishedPosts, { to: '2026-01-01T01:00:00.000Z' }, [])
    const query = req.query as { expressionValues: Record<string, string> }
    expect(query.expressionValues[':upper']).toBe('2026-01-01T01:00Z')
  })

  it('returns early by instant when `from` is after `to`, even if the raw strings are ordered', () => {
    // Raw strings: from < to, but by instant from (05:00Z) > to (01:00Z).
    const c = ctx({ from: '2026-01-01T00:00:00-05:00', to: '2026-01-01T01:00:00.000Z' })
    const req = listPublishedPosts.request(c) as Record<symbol, unknown>
    expect(req[EARLY_RETURN]).toBe(true)
  })

  it('returns early when an offset `from` is after now', () => {
    // The raw string sorts BEFORE now, so only a comparison on the
    // canonical value detects that the range is entirely in the future.
    const c = ctx({ from: '2025-12-31T23:00:00-05:00' }) // = 04:00Z
    const req = listPublishedPosts.request(c) as Record<symbol, unknown>
    expect(req[EARLY_RETURN]).toBe(true)
  })

  it('drops rows outside [from, to] by instant even when the raw string is inside', () => {
    const inRange = post('2026-01-01T01:30:00.000Z')
    // Raw string sorts inside [01:00Z, 02:00Z] but the instant is 06:30Z.
    const lexicallyInside = post('2026-01-01T01:30:00-05:00')
    const { res } = runList(
      listPublishedPosts,
      { from: '2026-01-01T01:00:00.000Z', to: '2026-01-01T02:00:00.000Z' },
      [lexicallyInside, inRange]
    )
    expect(res.items).toEqual([inRange])
  })

  it('keeps canonical rows and their order untouched', () => {
    const rows = [
      post('2026-01-01T02:00:00.000Z'),
      post('2026-01-01T01:00:00.000Z'),
      post('2025-12-31T00:00:00.000Z'),
    ]
    expect(runList(listPublishedPosts, {}, rows).res.items).toEqual(rows)
  })
})

describe('listPostsByTag key bound', () => {
  it('uses the canonical now string followed by the U+FFFF sentinel', () => {
    const { req } = runList(listPostsByTag, { tag: 'news' }, [])
    const query = req.query as { expressionValues: Record<string, string> }
    expect(query.expressionValues[':upper']).toBe(`${NOW}#￿`)
  })
})

// ---------------------------------------------------------------------------
// End-to-end: request key condition (evaluated lexically, as DynamoDB does on
// a string sort key) + response re-check. This is the honest picture of what
// a caller sees, including the gap this change does NOT close.
// ---------------------------------------------------------------------------

/**
 * Apply the resolver's key condition to `rows` the way DynamoDB would: the
 * sort key is compared as a string, rows are returned in SK order
 * (descending, as both list resolvers request), then the response runs.
 */
function runQuery(
  mod: ResolverModule,
  args: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
  skAttr: string
) {
  const c = ctx(args)
  const req = mod.request(c) as Record<string | symbol, unknown>
  if (req[EARLY_RETURN]) return { items: [] as Array<Record<string, unknown>> }
  const query = req.query as { expression: string; expressionValues: Record<string, string> }
  const upper = query.expressionValues[':upper']!
  const from = query.expressionValues[':from']
  const hit = rows
    .filter((r) => {
      const sk = String(r[skAttr])
      return sk <= upper && (from === undefined || sk >= from)
    })
    .sort((a, b) => (String(a[skAttr]) < String(b[skAttr]) ? 1 : -1))
  c.result = { items: hit, nextToken: null }
  return mod.response(c) as { items: Array<Record<string, unknown>> }
}

describe('end-to-end with lexical key conditions', () => {
  it('never exposes a future negative-offset Post row early (listPublishedPosts)', () => {
    // Sorts lexically before NOW (03:00Z) but is 04:00Z.
    const res = runQuery(listPublishedPosts, {}, [post('2025-12-31T23:00:00-05:00')], 'publishedAt')
    expect(res.items).toEqual([])
  })

  it('KNOWN GAP (#406): an already-live +09:00 Post row is cut by the byStatus key bound', () => {
    // 11:00+09:00 = 02:00Z, live at NOW, but its string sorts after
    // "2026-01-01T03:00:00.000Z", so DynamoDB never returns it. This holds
    // for existing rows AND for new rows written via the API, because the
    // Post row (the byStatus SK) is stored verbatim. Closing it requires
    // write-time normalization + a backfill (#406).
    const live = post('2026-01-01T11:00:00+09:00')
    expect(getVisible('2026-01-01T11:00:00+09:00')).toBe(true)
    expect(runQuery(listPublishedPosts, {}, [live], 'publishedAt').items).toEqual([])
  })

  it('KNOWN GAP (#406): mixed-offset Post rows are ordered by string, not instant', () => {
    const plus9 = post('2026-01-01T00:30:00+09:00') // = 2025-12-31T15:30Z
    const utc = post('2025-12-31T20:00:00.000Z')
    const res = runQuery(listPublishedPosts, {}, [utc, plus9], 'publishedAt')
    // Chronologically utc (20:00Z) is newer, but the +09:00 string sorts higher.
    expect(res.items.map((i) => i.publishedAt)).toEqual([plus9.publishedAt, utc.publishedAt])
  })

  it('a new +09:00 post is listed correctly by tag, because posttag-sync keys PostTag rows in canonical UTC', async () => {
    const { computePostTagDiff } = await import('../events/posttag-sync.js')
    const { puts } = computePostTagDiff({
      previous: null,
      next: {
        postId: 'p1',
        slug: 's1',
        title: 't',
        status: 'published',
        publishedAt: '2026-01-01T11:00:00+09:00', // = 02:00Z, live
        tags: ['news'],
      },
    } as never)
    const res = runQuery(listPostsByTag, { tag: 'news' }, puts as never, 'publishedAtPostId')
    expect(res.items.map((i) => i.postId)).toEqual(['p1'])
  })

  it('KNOWN GAP (#406): a legacy verbatim-keyed +09:00 PostTag row is cut until the post is re-saved', () => {
    const res = runQuery(
      listPostsByTag,
      { tag: 'news' },
      [tagRow('2026-01-01T11:00:00+09:00')],
      'publishedAtPostId'
    )
    expect(res.items).toEqual([])
  })
})

describe('listPublishedPosts from/to bounds keep equal instants spelled differently', () => {
  const run = (args: Record<string, unknown>, rows: Array<Record<string, unknown>>) =>
    runQuery(listPublishedPosts, args, rows, 'publishedAt').items.map((i) => i.publishedAt)

  it.each(['2026-01-01T01:00:00Z', '2026-01-01T01:00:00.000Z', '2026-01-01T10:00:00+09:00'])(
    'stored 2026-01-01T01:00:00Z is included with to=%s',
    (to) => {
      expect(run({ to }, [post('2026-01-01T01:00:00Z')])).toEqual(['2026-01-01T01:00:00Z'])
    }
  )

  it('stored minute-only 01:00Z is included with to=01:00:00.000Z', () => {
    expect(run({ to: '2026-01-01T01:00:00.000Z' }, [post('2026-01-01T01:00Z')])).toEqual([
      '2026-01-01T01:00Z',
    ])
  })

  it('stored 01:00:00.000000Z is included with from=01:00:00.000Z', () => {
    expect(
      run({ from: '2026-01-01T01:00:00.000Z' }, [post('2026-01-01T01:00:00.000000Z')])
    ).toEqual(['2026-01-01T01:00:00.000000Z'])
  })

  it('a row 30s after `to` in the same minute is read but dropped by instant', () => {
    const c = ctx({ to: '2026-01-01T01:00:00.000Z' })
    const req = listPublishedPosts.request(c) as {
      query: { expressionValues: Record<string, string> }
    }
    // The key bound admits it...
    expect('2026-01-01T01:00:30.000Z' <= req.query.expressionValues[':upper']!).toBe(true)
    // ...and the response removes it.
    expect(
      run({ to: '2026-01-01T01:00:00.000Z' }, [
        post('2026-01-01T01:00:30.000Z'),
        post('2026-01-01T00:59:00.000Z'),
      ])
    ).toEqual(['2026-01-01T00:59:00.000Z'])
  })

  it('returns every in-range row the raw-string bounds (main) returned', () => {
    // main used the raw from/to strings as key bounds. Each row below is in
    // [from, to] by instant AND inside the raw-string range, so main
    // returned it; the widened bounds must still return it.
    const from = '2026-01-01T00:00:00.000Z'
    const to = '2026-01-01T10:00:00+09:00' // = 01:00Z; raw string sorts after NOW
    // main's key range: [from, to < now ? to : now] compared as strings.
    const mainUpper = to < NOW ? to : NOW
    const rows = [
      post('2026-01-01T00:30:00.000Z'),
      post('2026-01-01T01:30:00+01:00'), // = 00:30Z
      post('2026-01-01T02:00:00+01:00'), // = 01:00Z (equal to `to`)
    ]
    for (const r of rows) {
      const sk = String(r.publishedAt)
      expect(sk >= from && sk <= mainUpper).toBe(true)
    }
    expect(run({ from, to }, rows).sort()).toEqual(rows.map((r) => r.publishedAt).sort())
  })
})
