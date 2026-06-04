import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single published post by slug.
//
// Reads the `bySlug` GSI: PK = slug. A slug identifies at most one row
// (uniqueness enforced at the admin form level), so this is an O(1) PK
// Query — no scan, no filter, no per-partition limit issues.
//
// Drafts are dropped in the response handler. If draft + published
// somehow share a slug we prefer the published row.
//
// Scheduled-publish: a `published` post is visible only when its
// publishedAt is absent (= immediate) OR <= now (= already live).
// When publishedAt is present and in the future the post is treated as
// "not yet live" and is hidden from the public site. This check is
// server-authoritative: the AppSync resolver enforces it on every read
// without relying on any client-side filtering.
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
  const now = util.time.nowISO8601()
  // Hide a published post only when publishedAt exists AND is in the future
  // (scheduled). Missing publishedAt = immediate publish.
  const published = items.find(
    (i) => i.status === 'published' && (!i.publishedAt || i.publishedAt <= now)
  )
  return published ?? null
}
