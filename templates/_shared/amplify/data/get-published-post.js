import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
//
// Reads the `bySiteIdStatus` GSI so the partition key already isolates
// the requesting site's published rows. Slug is enforced via filter —
// slug isn't part of the GSI key, and DynamoDB's filter runs *after*
// the limit. With `limit: 1` we'd only ever read one row from the
// partition (the latest published) and reject anything else, so older
// slugs would 404. We instead read up to 1000 rows per page (the
// service ceiling) and let the filter pick.
//
// For sites with > 1000 published posts a single page won't cover the
// whole partition; pagination via nextToken is a v1.0 concern. Until
// then this is correct for any realistic single-site post count.
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
    limit: 1000,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  return ctx.result.items?.[0] ?? null
}
