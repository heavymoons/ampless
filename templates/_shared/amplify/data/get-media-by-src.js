import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns a single Media row by S3 key.
//
// Reads the Media table's `bySrc` GSI: PK = src. The src is the full
// S3 key (`public/media/...`) and is unique across the table (uploads
// use a timestamp-prefixed naming scheme), so this is an O(1) PK
// Query with `limit: 1` — no scan, no filter.
//
// Returns null when no row matches (orphan / legacy assets); the
// caller (the `/api/media/...` route handler) falls back to an
// Amplify SSR HEAD via `getProperties` in that case.
//
// Authorisation is enforced by AppSync (`allow.publicApiKey()` on
// the schema declaration). The resolver itself only encodes the
// partition condition.
export function request(ctx) {
  const src = ctx.args.src
  return {
    operation: 'Query',
    index: 'bySrc',
    query: {
      expression: '#src = :src',
      expressionNames: { '#src': 'src' },
      expressionValues: util.dynamodb.toMapValues({ ':src': src }),
    },
    limit: 1,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  const items = ctx.result.items ?? []
  if (items.length === 0) return null
  const item = items[0]
  // Project explicitly onto the PublicMedia shape — drop mediaId /
  // delivery / anything else that might be added to the Media model
  // later so guests never see fields they shouldn't.
  return {
    src: item.src,
    size: item.size ?? null,
    mimeType: item.mimeType ?? null,
    metadata: item.metadata ?? null,
  }
}
