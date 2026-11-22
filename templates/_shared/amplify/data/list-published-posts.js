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
//   - `from` / `to` arguments are converted to canonical UTC before they
//     become key bounds, so offset arguments select the right range of
//     canonical rows.
//   - every returned row is re-checked by instant (epoch ms) in the
//     response: rows whose publishedAt is after now, outside [from, to], or
//     unparseable are dropped. This stops a negative-offset row (e.g.
//     `...T00:00:00-05:00`, lexically "earlier" than its instant) from
//     going public before its time.
//   - limitation: the key range is not widened, so a non-canonical
//     positive-offset row (`...+09:00`) that is already live stays outside
//     the lexical `<= now` bound until its local wall-clock passes, i.e. it
//     appears in this listing late (never early), and mixed-offset rows may
//     be ordered by string rather than instant. Re-saving the post's
//     publishedAt in the admin UI rewrites it in canonical UTC.
// A page may therefore hold fewer than `limit` items only when such
// non-canonical rows were dropped; canonical data is unaffected.

const CANONICAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

function toMs(value) {
  if (!value) return undefined
  const ms = util.time.parseISO8601ToEpochMilliSeconds(value)
  return typeof ms === 'number' ? ms : undefined
}

function toCanonical(value, ms) {
  if (typeof ms !== 'number') return value
  return util.time.epochMilliSecondsToFormatted(ms, CANONICAL_FORMAT, 'UTC')
}

export function request(ctx) {
  const { from, to, limit, nextToken } = ctx.args
  const nowMs = util.time.nowEpochMilliSeconds()
  const now = util.time.epochMilliSecondsToFormatted(nowMs, CANONICAL_FORMAT, 'UTC')
  const fromMs = toMs(from)
  const toArgMs = toMs(to)
  const fromKey = from ? toCanonical(from, fromMs) : undefined
  const toKey = to ? toCanonical(to, toArgMs) : undefined

  ctx.stash.nowMs = nowMs
  ctx.stash.fromMs = fromMs
  ctx.stash.toMs = toArgMs

  // Always clamp the upper bound to now so future-dated posts are excluded.
  const upper = toKey && toKey < now ? toKey : now

  // If `from` is later than `upper` the range is empty — skip the query
  // rather than letting DynamoDB see an inverted BETWEEN / >= condition.
  if (fromKey && fromKey > upper) {
    return runtime.earlyReturn({ items: [], nextToken: null })
  }

  let keyExpression = '#status = :status'
  const expressionNames = { '#status': 'status', '#publishedAt': 'publishedAt' }
  const expressionValueMap = { ':status': 'published', ':upper': upper }

  if (fromKey) {
    keyExpression += ' AND #publishedAt BETWEEN :from AND :upper'
    expressionValueMap[':from'] = fromKey
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
