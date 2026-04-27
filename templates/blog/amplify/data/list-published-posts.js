import { util } from '@aws-appsync/utils'

// AppSync JS resolver: returns posts where status='published'.
// Uses the `byStatus` GSI so we never have to scan-and-filter across drafts.
// Authorization is enforced by AppSync; this resolver only enforces the
// `status='published'` partition condition so guests can never observe
// drafts even if they call the underlying AppSync API directly.
export function request(ctx) {
  const siteId = ctx.args.siteId ?? 'default'
  return {
    operation: 'Query',
    index: 'byStatus',
    query: {
      expression: '#status = :status',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'published' }),
    },
    // Filter by siteId after the GSI query. (For multi-site deployments at
    // scale, v0.2 will introduce a composite GSI keyed by siteId+status to
    // avoid cross-site scan.)
    filter: {
      expression: '#siteId = :siteId',
      expressionNames: { '#siteId': 'siteId' },
      expressionValues: util.dynamodb.toMapValues({ ':siteId': siteId }),
    },
    scanIndexForward: false, // newest first
    limit: ctx.args.limit ?? 100,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  return ctx.result.items ?? []
}
