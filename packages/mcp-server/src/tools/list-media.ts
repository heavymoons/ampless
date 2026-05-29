import type { GraphqlClient, StorageClient } from './types.js'
import { MEDIA_FIELDS, type MediaRow, toMediaResult } from './media-mapping.js'

const QUERY = /* GraphQL */ `
  ${MEDIA_FIELDS}
  query ListMedia($filter: ModelMediaFilterInput, $limit: Int, $nextToken: String) {
    listMedia(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        ...MediaFields
      }
      nextToken
    }
  }
`

export interface ListMediaArgs {
  limit?: number
  nextToken?: string
  /** Match by MIME prefix: "image/" → all images, "image/png" → PNG only. */
  mimeType?: string
  /** Match by S3 key prefix, e.g. "public/media/2024/" for a given year. */
  prefix?: string
  /** ISO 8601; include rows with createdAt >= this. */
  createdAfter?: string
  /** ISO 8601; include rows with createdAt <= this. */
  createdBefore?: string
}

export const listMediaSchema = {
  type: 'object',
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'Max results (default 20)',
    },
    nextToken: { type: 'string', description: 'Pagination cursor from a previous call' },
    mimeType: {
      type: 'string',
      description:
        'Filter by MIME type prefix (beginsWith): "image/" matches all images, "image/png" matches PNG only.',
    },
    prefix: {
      type: 'string',
      description:
        'Filter by S3 key prefix (beginsWith) on `src`, e.g. "public/media/2024/" to find files from a given year.',
    },
    createdAfter: {
      type: 'string',
      description: 'ISO 8601 timestamp; only return media created at or after this.',
    },
    createdBefore: {
      type: 'string',
      description: 'ISO 8601 timestamp; only return media created at or before this.',
    },
  },
} as const

/**
 * Build a `ModelMediaFilterInput` from the supplied filters. Returns
 * `undefined` when no filter is requested, the single condition when
 * exactly one applies, or an `{ and: [...] }` wrapper when several do.
 */
export function buildMediaFilter(args: ListMediaArgs): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = []
  if (args.mimeType) conditions.push({ mimeType: { beginsWith: args.mimeType } })
  if (args.prefix) conditions.push({ src: { beginsWith: args.prefix } })
  if (args.createdAfter && args.createdBefore) {
    conditions.push({ createdAt: { between: [args.createdAfter, args.createdBefore] } })
  } else if (args.createdAfter) {
    conditions.push({ createdAt: { ge: args.createdAfter } })
  } else if (args.createdBefore) {
    conditions.push({ createdAt: { le: args.createdBefore } })
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { and: conditions }
}

/**
 * List media files with optional filters by MIME prefix, S3 key prefix,
 * and creation date range. Returns up to `limit` rows (default 20) plus
 * a `nextToken` cursor.
 *
 * Note: filters are applied by DynamoDB *after* the page read, so a page
 * may return fewer than `limit` rows while a `nextToken` remains — follow
 * the cursor to get more. (`search_media` walks the cursor internally;
 * `list_media` returns one page so callers can paginate explicitly.)
 */
export async function listMedia(
  graphql: GraphqlClient,
  storage: StorageClient,
  args: ListMediaArgs = {},
) {
  const filter = buildMediaFilter(args)
  const data = await graphql.query<{
    listMedia: { items: MediaRow[]; nextToken: string | null }
  }>(QUERY, {
    filter,
    limit: args.limit ?? 20,
    nextToken: args.nextToken,
  })

  return {
    media: data.listMedia.items.map((row) => toMediaResult(row, storage)),
    nextToken: data.listMedia.nextToken,
  }
}
