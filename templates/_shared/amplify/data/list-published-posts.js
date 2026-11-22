import { util, runtime } from '@aws-appsync/utils'

// AppSync JS resolver: list published posts, newest first.
//
// Reads the `byStatus` GSI:
//   PK = status   (denormalized field set by writers)
//   SK = publishedAt
// so a single Query reads only the `published` partition. Drafts never
// appear because the PK condition pins status='published'.
//
// Scheduled-publish: the upper bound of the SK range is always clamped
// to `now`. This ensures future-dated published posts (scheduled but not
// yet live) never appear in public listings. The upper bound is the lesser
// of `now` and any caller-supplied `to` argument.
//
// Reverse-range guard: if `from` is supplied and ends up > upper (e.g.
// the caller asks for a range entirely in the future), we return an empty
// result early via `runtime.earlyReturn` instead of issuing an inverted
// BETWEEN to DynamoDB (which DynamoDB rejects with a ValidationException).
//
// Date-range filtering (`from`, `to`) is pushed into the SK condition,
// so DynamoDB only reads the matching range. `nextToken` paginates
// without re-issuing a fresh query.
//
// Timezone offsets: the SK is compared as a string, and lexical order
// equals chronological order only for canonical fixed-width UTC values
// (`YYYY-MM-DDTHH:mm:ss.sssZ`, what the admin UI and MCP tools write).
// AWSDateTime also accepts offsets (`+09:00`), missing seconds, etc., and
// direct API writes store those verbatim. So:
//   - key bounds never return fewer rows than a plain string bound on the
//     raw arguments would. The `now` bound is the exact canonical now
//     string. A `to` earlier than now becomes the lexical max of the raw
//     `to` and `<minute of to in UTC>Z` (never above the now key), and
//     `from` becomes the lexical min
//     of the raw `from` and `<minute of from in UTC>`. `...HH:mmZ` sorts at
//     or above every Z-suffixed spelling of an instant in that minute
//     (`...:ssZ` > `...:ss.sssZ` because 'Z' > '.'), and the bare minute
//     prefix sorts at or below all of them (`...:00.000000Z` < `...:00.000Z`),
//     so equal instants spelled differently are not cut off. The extra rows
//     this may read (at most a minute either side) are removed below.
//   - every returned row is re-checked by instant (epoch ms) in the
//     response: rows whose publishedAt is after now, outside [from, to], or
//     unparseable are dropped. This stops a negative-offset row (e.g.
//     `...T00:00:00-05:00`, lexically "earlier" than its instant) from
//     going public before its time.
//   - limitation (#406): the `now` bound is not widened, so a non-canonical
//     positive-offset row (`...+09:00`) that is already live stays outside
//     the lexical `<= now` bound until its local wall-clock passes, i.e. it
//     appears in this listing late (never early), and mixed-offset rows may
//     be ordered by string rather than instant. This applies to new direct
//     API writes too until write-time normalization lands. Re-saving the post's
//     publishedAt in the admin UI rewrites it in canonical UTC.
//
// Short pages: DynamoDB applies `limit` BEFORE this response handler, so
// when rows are dropped a page can hold fewer than `limit` items (even none)
// while `nextToken` is still set — the same contract as any filtered
// AppSync connection. Callers must keep following `nextToken`; the official
// runtime (`@ampless/runtime` createPostsApi) fills each page that way.
// Canonical data is unaffected: only non-canonical rows and rows within a
// minute outside [from, to] are ever dropped.

const CANONICAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
const MINUTE_FORMAT = "yyyy-MM-dd'T'HH:mm"

function toMs(value) {
  if (!value) return undefined
  const ms = util.time.parseISO8601ToEpochMilliSeconds(value)
  return typeof ms === 'number' ? ms : undefined
}

function minuteFloor(ms) {
  return util.time.epochMilliSecondsToFormatted(ms, MINUTE_FORMAT, 'UTC')
}

export function request(ctx) {
  const { from, to, limit, nextToken } = ctx.args
  const nowMs = util.time.nowEpochMilliSeconds()
  const now = util.time.epochMilliSecondsToFormatted(nowMs, CANONICAL_FORMAT, 'UTC')
  const fromMs = toMs(from)
  const toArgMs = toMs(to)

  ctx.stash.nowMs = nowMs
  ctx.stash.fromMs = fromMs
  ctx.stash.toMs = toArgMs

  // Upper bound: always clamped to now so future-dated posts are excluded.
  let upper = now
  if (to) {
    if (typeof toArgMs === 'number') {
      if (toArgMs < nowMs) {
        const minuteKey = minuteFloor(toArgMs) + 'Z'
        const toKey = to > minuteKey ? to : minuteKey
        // Never above the now key (a raw offset `to` can sort after it).
        upper = toKey < now ? toKey : now
      }
    } else if (to < now) {
      upper = to
    }
  }

  // Lower bound (only when `from` is given).
  let lower = undefined
  if (from) {
    if (typeof fromMs === 'number') {
      const minuteKey = minuteFloor(fromMs)
      lower = from < minuteKey ? from : minuteKey
    } else {
      lower = from
    }
  }

  // If `from` is later than the upper limit the range is empty — skip the
  // query rather than letting DynamoDB see an inverted BETWEEN condition.
  if (from) {
    const upperMs = typeof toArgMs === 'number' && toArgMs < nowMs ? toArgMs : nowMs
    if (typeof fromMs === 'number' && fromMs > upperMs) {
      return runtime.earlyReturn({ items: [], nextToken: null })
    }
    if (lower > upper) {
      return runtime.earlyReturn({ items: [], nextToken: null })
    }
  }

  let keyExpression = '#status = :status'
  const expressionNames = { '#status': 'status', '#publishedAt': 'publishedAt' }
  const expressionValueMap = { ':status': 'published', ':upper': upper }

  if (lower !== undefined) {
    keyExpression += ' AND #publishedAt BETWEEN :from AND :upper'
    expressionValueMap[':from'] = lower
  } else {
    keyExpression += ' AND #publishedAt <= :upper'
  }

  return {
    operation: 'Query',
    index: 'byStatus',
    query: {
      expression: keyExpression,
      expressionNames,
      expressionValues: util.dynamodb.toMapValues(expressionValueMap),
    },
    scanIndexForward: false, // newest first
    limit: limit ?? 20,
    nextToken: nextToken ?? undefined,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  const { nowMs, fromMs, toMs: toArgMs } = ctx.stash
  const items = (ctx.result.items ?? []).filter((item) => {
    const ms = toMs(item.publishedAt)
    if (typeof ms !== 'number' || ms > nowMs) return false
    if (typeof fromMs === 'number' && ms < fromMs) return false
    if (typeof toArgMs === 'number' && ms > toArgMs) return false
    return true
  })
  return {
    items,
    nextToken: ctx.result.nextToken ?? null,
  }
}
