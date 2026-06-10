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

export async function listPosts(client: GraphqlClient, args: ListPostsArgs = {}) {
  // Clamp and normalise — inputSchema is not validated by dispatchToolCall
  const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 20)))
  const offset = Math.max(0, Math.trunc(args.offset ?? 0))
  const status = args.status ?? 'all'

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
    query: args.query,
    tag: args.tag,
    sort: args.sort,
    // status already applied server-side; pass 'all' to avoid double-filter
    status: 'all',
  })

  const total = filtered.length
  const posts = filtered.slice(offset, offset + limit)

  return { posts, total, offset, limit }
}
