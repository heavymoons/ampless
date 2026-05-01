import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
//
// Reads the `bySiteIdStatus` GSI so the partition key already isolates
// the requesting site's published rows. Slug is enforced via filter
// (slug is not part of the GSI key but the partition is small enough
// per site that a filter is cheap).
export function request(ctx) {
  const siteId = ctx.args.siteId ?? 'default'
  const slug = ctx.args.slug
  const partition = `${siteId}#published`
  return {
    operation: 'Query',
    index: 'bySiteIdStatus',
    query: {
      expression: '#siteIdStatus = :siteIdStatus',
      expressionNames: { '#siteIdStatus': 'siteIdStatus' },
      expressionValues: util.dynamodb.toMapValues({ ':siteIdStatus': partition }),
    },
    filter: {
      expression: '#slug = :slug',
      expressionNames: { '#slug': 'slug' },
      expressionValues: util.dynamodb.toMapValues({ ':slug': slug }),
    },
    limit: 1,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  return ctx.result.items?.[0] ?? null
}
