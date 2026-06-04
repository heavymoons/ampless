import { util } from '@aws-appsync/utils'

// AppSync JS resolver: list published posts for a given tag, newest first.
// Reads the denormalized PostTag table where:
//   PK = tag
//   SK = `${publishedAt}#${postId}` (so descending SK = newest first)
//
// Authorization is enforced by AppSync; the resolver itself only encodes
// the tag partition condition. Drafts never appear here because the
// admin client only writes PostTag rows for posts whose status is
// 'published'.
//
// Scheduled-publish: the SK is a composite of `${publishedAt}#${postId}`.
// ISO 8601 timestamps are fixed-width to millisecond precision, so lexical
// order == chronological order. We add an upper-bound SK condition
// `<= now + '#' + '￿'` to exclude PostTag rows whose publishedAt is in
// the future. U+FFFF sorts above every character that can appear in a real
// postId, so `now#￿` is strictly greater than `now#<any-postId>`:
// every postId suffix sharing the current-millisecond ISO prefix is
// included, while any SK whose timestamp prefix is later is excluded.
// (Written as an escape so this source file stays ASCII.)
export function request(ctx) {
  const { tag, limit, nextToken } = ctx.args
  const now = util.time.nowISO8601()
  const upper = now + '#￿'
  return {
    operation: 'Query',
    query: {
      expression: '#tag = :tag AND #pap <= :upper',
      expressionNames: { '#tag': 'tag', '#pap': 'publishedAtPostId' },
      expressionValues: util.dynamodb.toMapValues({ ':tag': tag, ':upper': upper }),
    },
    scanIndexForward: false, // newest first (SK descends)
    limit: limit ?? 20,
    nextToken: nextToken ?? undefined,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  // PostTag rows are summary records (no `body`). Map them to the same
  // PublicPost shape `listPublishedPosts` returns; the detail view should
  // call `getPublishedPost(slug)` for the full body.
  const items = (ctx.result.items ?? []).map((row) => ({
    postId: row.postId,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? null,
    format: 'markdown',
    body: null,
    status: 'published',
    publishedAt: row.publishedAt,
    tags: row.tags ?? [],
  }))

  return {
    items,
    nextToken: ctx.result.nextToken ?? null,
  }
}
