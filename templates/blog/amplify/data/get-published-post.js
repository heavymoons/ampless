import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
// Uses the `byStatus` GSI so drafts are dropped at the index partition.
export function request(ctx) {
  const siteId = ctx.args.siteId ?? 'default'
  const slug = ctx.args.slug
  return {
    operation: 'Query',
    index: 'byStatus',
    query: {
      expression: '#status = :status',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'published' }),
    },
    filter: {
      expression: '#siteId = :siteId AND #slug = :slug',
      expressionNames: { '#siteId': 'siteId', '#slug': 'slug' },
      expressionValues: util.dynamodb.toMapValues({ ':siteId': siteId, ':slug': slug }),
    },
    limit: 1,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  return ctx.result.items?.[0] ?? null
}
