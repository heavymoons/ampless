import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns only posts with status='published'.
// Authorization is enforced by AppSync; the resolver itself just guarantees
// the filter so guests can never observe drafts via this endpoint.
export function request(ctx) {
  const siteId = ctx.args.siteId ?? 'default'
  return {
    operation: 'Query',
    query: {
      expression: '#siteId = :siteId',
      expressionNames: { '#siteId': 'siteId' },
      expressionValues: util.dynamodb.toMapValues({ ':siteId': siteId }),
    },
    filter: {
      expression: '#status = :status',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'published' }),
    },
    limit: ctx.args.limit ?? 100,
  }
}

export function response(ctx) {
  return ctx.result.items ?? []
}
