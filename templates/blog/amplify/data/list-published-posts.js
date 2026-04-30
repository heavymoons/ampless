import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns posts where status='published'.
// Uses the `byStatus` GSI: PK=status, SK=publishedAt. So:
//   - newest-first ordering is free (scanIndexForward: false)
//   - date-range filtering (`from`, `to`) is pushed to the SK condition,
//     reading only the matching range instead of the whole partition
//   - `nextToken` lets callers paginate without re-issuing a fresh query
//
// Authorization is enforced by AppSync; this resolver guarantees the
// `status='published'` partition condition so guests can never observe
// drafts even if they call the underlying AppSync API directly.
export function request(ctx) {
  const { siteId = 'default', from, to, limit, nextToken } = ctx.args

  // Build SK condition: optionally restrict by publishedAt range.
  let keyExpression = '#status = :status'
  const expressionNames = { '#status': 'status' }
  const expressionValueMap = { ':status': 'published' }

  if (from && to) {
    keyExpression += ' AND #publishedAt BETWEEN :from AND :to'
    expressionNames['#publishedAt'] = 'publishedAt'
    expressionValueMap[':from'] = from
    expressionValueMap[':to'] = to
  } else if (from) {
    keyExpression += ' AND #publishedAt >= :from'
    expressionNames['#publishedAt'] = 'publishedAt'
    expressionValueMap[':from'] = from
  } else if (to) {
    keyExpression += ' AND #publishedAt <= :to'
    expressionNames['#publishedAt'] = 'publishedAt'
    expressionValueMap[':to'] = to
  }

  return {
    operation: 'Query',
    index: 'byStatus',
    query: {
      expression: keyExpression,
      expressionNames,
      expressionValues: util.dynamodb.toMapValues(expressionValueMap),
    },
    // Filter by siteId after the GSI query. (For multi-tenant deployments
    // we'd add a composite GSI keyed by siteId+status; out of scope for v0.1.)
    filter: {
      expression: '#siteId = :siteId',
      expressionNames: { '#siteId': 'siteId' },
      expressionValues: util.dynamodb.toMapValues({ ':siteId': siteId }),
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
