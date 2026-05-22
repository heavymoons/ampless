import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
//
// Reads the `bySlug` GSI: PK = slug. A slug identifies at most one row
// (uniqueness enforced at the admin form level), so this is an O(1) PK
// Query — no scan, no filter, no per-partition limit issues.
//
// Drafts are dropped in the response handler. If draft + published
// somehow share a slug we prefer the published row.
export function request(ctx) {
  const slug = ctx.args.slug
  return {
    operation: 'Query',
    index: 'bySlug',
    query: {
      expression: '#slug = :slug',
      expressionNames: { '#slug': 'slug' },
      expressionValues: util.dynamodb.toMapValues({ ':slug': slug }),
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
