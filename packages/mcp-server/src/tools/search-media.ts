import type { GraphqlClient, StorageClient } from './types.js'
import { MEDIA_FIELDS, type MediaRow, toMediaResult } from './media-mapping.js'

const QUERY = /* GraphQL */ `
  ${MEDIA_FIELDS}
  query SearchMedia($filter: ModelMediaFilterInput, $limit: Int, $nextToken: String) {
    listMedia(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        ...MediaFields
      }
      nextToken
    }
  }
`

/**
 * Safety cap on how many DynamoDB pages a single search walks before
 * giving up. Each page examines up to `limit` rows, so the worst-case
 * scan is `MAX_PAGES * limit` rows — enough to cover small/medium media
 * tables without an unbounded scan on a sparse-match query.
 */
const MAX_PAGES = 20

export interface SearchMediaArgs {
  query: string
  limit?: number
  nextToken?: string
}

export const searchMediaSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      description:
        'Substring matched (case-sensitive `contains`) against `src` (which includes the filename) and `mimeType`. e.g. "logo", ".png", "image/png".',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description:
        'Target number of matches to collect before stopping (default 20). A soft target — the last page may push the result slightly past it.',
    },
    nextToken: { type: 'string', description: 'Pagination cursor from a previous call' },
  },
} as const

/**
 * Search media by substring across `src` (filename + key) and
 * `mimeType`.
 *
 * DynamoDB applies the `contains` filter *after* reading each page, so a
 * single page can return far fewer matches than its examine limit (or
 * none at all) while a `nextToken` still remains. To spare the caller
 * from looping, this walks the cursor internally until it has collected
 * at least `limit` matches, exhausts the table, or hits `MAX_PAGES`.
 *
 * `limit` is therefore a soft target: the final page may carry the
 * result a little past it (matches are never dropped to honour the
 * exact count — that would lose data, which defeats a "find files to
 * delete" search). The returned `nextToken` continues after the last
 * examined page, so a follow-up call neither skips nor duplicates rows.
 * `truncated: true` means the page cap was hit with a cursor still
 * outstanding — pass the `nextToken` back to keep scanning.
 */
export async function searchMedia(
  graphql: GraphqlClient,
  storage: StorageClient,
  args: SearchMediaArgs,
) {
  if (!args.query) {
    throw new Error('search_media: `query` is required')
  }
  const limit = args.limit ?? 20
  const filter = {
    or: [{ src: { contains: args.query } }, { mimeType: { contains: args.query } }],
  }

  const media: ReturnType<typeof toMediaResult>[] = []
  let token: string | null = args.nextToken ?? null
  let pages = 0

  do {
    const data: { listMedia: { items: MediaRow[]; nextToken: string | null } } =
      await graphql.query(QUERY, {
        filter,
        limit,
        nextToken: token ?? undefined,
      })
    pages += 1
    for (const row of data.listMedia.items) {
      media.push(toMediaResult(row, storage))
    }
    token = data.listMedia.nextToken
  } while (media.length < limit && token && pages < MAX_PAGES)

  const truncated = media.length < limit && token !== null && pages >= MAX_PAGES

  return {
    media,
    nextToken: token,
    ...(truncated ? { truncated: true as const } : {}),
  }
}
