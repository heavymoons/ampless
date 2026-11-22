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
//
// The comparison is between instants (epoch ms), not strings: AWSDateTime
// accepts offsets (`+09:00`), missing seconds, etc., and direct API writes
// store those verbatim, so a lexical compare against the UTC now string
// would publish such posts early or late. A publishedAt that does not
// parse (parseISO8601ToEpochMilliSeconds returns undefined) fails closed:
// the post stays hidden.
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
  const nowMs = util.time.nowEpochMilliSeconds()
  // Hide a published post only when publishedAt exists AND is not yet live
  // (scheduled, or unparseable). Missing publishedAt = immediate publish.
  const published = items.find((i) => {
    if (i.status !== 'published') return false
    if (!i.publishedAt) return true
    const ms = util.time.parseISO8601ToEpochMilliSeconds(i.publishedAt)
    return typeof ms === 'number' && ms <= nowMs
  })
  return published ?? null
}
