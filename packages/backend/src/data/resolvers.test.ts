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
        if (format !== "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" || zone !== 'UTC') {
          throw new Error(`unexpected format ${format} ${zone}`)
        }
        return new Date(ms).toISOString()
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

describe('publishedAt visibility is decided by instant, consistently', () => {
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
  ])('%s → visible=%s in get / list / tag', (publishedAt, visible) => {
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

  it('canonicalizes offset from/to arguments before using them as key bounds', () => {
    const { req } = runList(
      listPublishedPosts,
      { from: '2026-01-01T09:00:00+09:00', to: '2026-01-01T10:00:00+09:00' },
      []
    )
    const query = req.query as { expression: string; expressionValues: Record<string, string> }
    expect(query.expression).toBe('#status = :status AND #publishedAt BETWEEN :from AND :upper')
    expect(query.expressionValues[':from']).toBe('2026-01-01T00:00:00.000Z')
    expect(query.expressionValues[':upper']).toBe('2026-01-01T01:00:00.000Z')
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
