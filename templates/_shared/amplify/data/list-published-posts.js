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
export function request(ctx) {
  const { from, to, limit, nextToken } = ctx.args
  const now = util.time.nowISO8601()
  // Always clamp the upper bound to now so future-dated posts are excluded.
  const upper = to && to < now ? to : now

  // If `from` is later than `upper` the range is empty — skip the query
  // rather than letting DynamoDB see an inverted BETWEEN / >= condition.
  if (from && from > upper) {
    return runtime.earlyReturn({ items: [], nextToken: null })
  }

  let keyExpression = '#status = :status'
  const expressionNames = { '#status': 'status', '#publishedAt': 'publishedAt' }
  const expressionValueMap = { ':status': 'published', ':upper': upper }

  if (from) {
    keyExpression += ' AND #publishedAt BETWEEN :from AND :upper'
    expressionValueMap[':from'] = from
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
  return {
    items: ctx.result.items ?? [],
    nextToken: ctx.result.nextToken ?? null,
  }
}
