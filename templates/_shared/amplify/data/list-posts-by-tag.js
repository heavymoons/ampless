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
//
// Timezone offsets: the trusted processor (posttag-sync) writes the SK and
// `publishedAt` of new PostTag rows in canonical fixed-width UTC, so the
// lexical bound above is exact for them. Rows written before that change
// may still carry a post's verbatim AWSDateTime (`+09:00`, no seconds,
// ...) until the post is next saved, so the response re-checks every row
// by instant (epoch ms) and drops rows that are not yet live or whose
// publishedAt does not parse. A legacy negative-offset row therefore never
// goes public early; a legacy positive-offset row stays above the lexical
// bound, appearing late, until the post's next save rewrites it.
//
// Short pages: DynamoDB applies `limit` BEFORE this response handler, so
// when legacy rows are dropped a page can hold fewer than `limit` items
// (even none) while `nextToken` is still set. Callers must keep following
// `nextToken`; the official runtime (`@ampless/runtime` createPostsApi)
// fills each page that way. Canonical rows are never dropped here.
export function request(ctx) {
  const { tag, limit, nextToken } = ctx.args
  const nowMs = util.time.nowEpochMilliSeconds()
  const now = util.time.epochMilliSecondsToFormatted(nowMs, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", 'UTC')
  ctx.stash.nowMs = nowMs
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
  const nowMs = ctx.stash.nowMs
  const items = (ctx.result.items ?? [])
    .filter((row) => {
      const ms = row.publishedAt
        ? util.time.parseISO8601ToEpochMilliSeconds(row.publishedAt)
        : undefined
      return typeof ms === 'number' && ms <= nowMs
    })
    .map((row) => ({
      postId: row.postId,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? null,
      // `format` is denormalized onto the PostTag row by the trusted processor
      // (posttag-sync), so tag pages get the post's real format. `?? null`
      // guards rows written before the field existed — the runtime then applies
      // its documented `?? 'markdown'` fallback for those.
      format: row.format ?? null,
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
