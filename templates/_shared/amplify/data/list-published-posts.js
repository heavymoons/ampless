import { util } from '@aws-appsync/utils'

// AppSync JS resolver: list published posts, newest first.
//
// Reads the `byStatus` GSI:
//   PK = status   (denormalized field set by writers)
//   SK = publishedAt
// so a single Query reads only the `published` partition. Drafts never
// appear because the PK condition pins status='published'.
//
// Date-range filtering (`from`, `to`) is pushed into the SK condition,
// so DynamoDB only reads the matching range. `nextToken` paginates
// without re-issuing a fresh query.
export function request(ctx) {
  const { from, to, limit, nextToken } = ctx.args

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
