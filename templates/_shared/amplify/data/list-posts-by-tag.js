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
export function request(ctx) {
  const { tag, limit, nextToken } = ctx.args
  return {
    operation: 'Query',
    query: {
      expression: '#tag = :tag',
      expressionNames: { '#tag': 'tag' },
      expressionValues: util.dynamodb.toMapValues({ ':tag': tag }),
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
