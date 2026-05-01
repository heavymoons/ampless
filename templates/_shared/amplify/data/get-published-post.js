import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
//
// Reads the `bySiteIdSlug` GSI: PK = `${siteId}#${slug}`. A given
// (site, slug) tuple identifies at most one row, so this is an O(1)
// PK Query — no scan, no filter, no per-partition limit issues.
//
// Drafts are dropped in the response handler. The admin form
// enforces a unique slug per site at the application layer, but if
// somehow draft + published share a slug we prefer the published row.
export function request(ctx) {
  const siteId = ctx.args.siteId ?? 'default'
  const slug = ctx.args.slug
  const partition = `${siteId}#${slug}`
  return {
    operation: 'Query',
    index: 'bySiteIdSlug',
    query: {
      expression: '#siteIdSlug = :siteIdSlug',
      expressionNames: { '#siteIdSlug': 'siteIdSlug' },
      expressionValues: util.dynamodb.toMapValues({ ':siteIdSlug': partition }),
    },
    limit: 5,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  const items = ctx.result.items ?? []
  const published = items.find((i) => i.status === 'published')
  return published ?? null
}
