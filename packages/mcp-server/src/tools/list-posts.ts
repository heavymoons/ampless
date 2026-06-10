import { filterSortPostSummaries, type PostListSort } from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_SUMMARY_FIELDS, toPostSummary, type PostSummaryWithFormat } from './post-mapping.js'

const QUERY = /* GraphQL */ `
  ${POST_SUMMARY_FIELDS}
  query ListPosts($filter: ModelPostFilterInput, $limit: Int, $nextToken: String) {
    listPosts(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        ...PostSummaryFields
      }
      nextToken
    }
  }
`

export interface ListPostsArgs {
  query?: string
  tag?: string
  status?: 'draft' | 'published' | 'all'
  sort?: PostListSort
  limit?: number
  offset?: number
}

export const listPostsSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Case-insensitive substring match over title / slug / tags',
    },
    tag: {
      type: 'string',
      description: 'Exact tag filter',
    },
    status: {
      type: 'string',
      enum: ['draft', 'published', 'all'],
      description: 'Filter by status (default "all")',
    },
    sort: {
      type: 'string',
      enum: [
        'updated-desc',
        'updated-asc',
        'published-desc',
        'published-asc',
        'title-asc',
        'title-desc',
      ],
      description: 'Sort order (default "updated-desc" — most recently edited first)',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'Max results per page (default 20)',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description: 'Zero-based offset into the filtered result set (default 0)',
    },
  },
} as const

const VALID_STATUS = new Set<string>(['draft', 'published', 'all'])
const VALID_SORT = new Set<string>([
  'updated-desc',
  'updated-asc',
  'published-desc',
  'published-asc',
  'title-asc',
  'title-desc',
])

/**
 * Accept only string values; anything else (a number / object from a
 * sloppy JSON-RPC caller) is treated as "not provided".
 */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * Finite-integer coercion with fallback. `Number("abc")` is NaN and must
 * fall back to the default — NaN would survive Math.trunc/min/max and
 * serialise as `null` in the JSON response.
 */
function asInt(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export async function listPosts(client: GraphqlClient, args: ListPostsArgs = {}) {
  // Normalise EVERY arg at runtime — `dispatchToolCall` does NOT validate
  // inputSchema, so raw JSON-RPC args can carry wrong types or out-of-enum
  // values. Without this: `limit: "abc"` → NaN → serialises as null,
  // `query: 1` throws inside filterSortPostSummaries, and an invalid
  // `status` would be pushed into the GraphQL filter as-is.
  const limit = Math.min(100, Math.max(1, asInt(args.limit, 20)))
  const offset = Math.max(0, asInt(args.offset, 0))
  const rawStatus = asString(args.status)
  const status = (rawStatus && VALID_STATUS.has(rawStatus) ? rawStatus : 'all') as
    | 'draft'
    | 'published'
    | 'all'
  const rawSort = asString(args.sort)
  const sort = (rawSort && VALID_SORT.has(rawSort) ? rawSort : undefined) as
    | PostListSort
    | undefined
  const query = asString(args.query)
  const tag = asString(args.tag)

  // Build GraphQL filter — push status down to DDB for efficiency
  const filter: Record<string, unknown> = {}
  if (status !== 'all') filter.status = { eq: status }
  const hasFilter = Object.keys(filter).length > 0

  // Fetch all summaries via internal do/while paging (page size 200)
  interface ListPostsPage {
    listPosts: { items: Parameters<typeof toPostSummary>[0][]; nextToken: string | null }
  }
  const allItems: PostSummaryWithFormat[] = []
  let cursor: string | null = null
  do {
    // eslint-disable-next-line no-await-in-loop
    const data: ListPostsPage = await client.query<ListPostsPage>(QUERY, {
      filter: hasFilter ? filter : undefined,
      limit: 200,
      nextToken: cursor,
    })
    for (const item of data.listPosts.items) {
      allItems.push(toPostSummary(item))
    }
    cursor = data.listPosts.nextToken
  } while (cursor)

  // In-process filter / sort (query, tag, sort) — status already pushed to GQL
  const filtered = filterSortPostSummaries(allItems, {
    query,
    tag,
    sort,
    // status already applied server-side; pass 'all' to avoid double-filter
    status: 'all',
  })

  const total = filtered.length
  const posts = filtered.slice(offset, offset + limit)

  return { posts, total, offset, limit }
}
