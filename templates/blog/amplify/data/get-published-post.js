import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
export function request(ctx) {
  const siteId = ctx.args.siteId ?? 'default'
  const slug = ctx.args.slug
  return {
    operation: 'Query',
    query: {
      expression: '#siteId = :siteId',
      expressionNames: { '#siteId': 'siteId' },
      expressionValues: util.dynamodb.toMapValues({ ':siteId': siteId }),
    },
    filter: {
      expression: '#status = :status AND #slug = :slug',
      expressionNames: { '#status': 'status', '#slug': 'slug' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'published', ':slug': slug }),
    },
    limit: 1,
  }
}

export function response(ctx) {
  return ctx.result.items?.[0] ?? null
}
