import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'

const QUERY = /* GraphQL */ `
  ${POST_FIELDS}
  query ListPosts($filter: ModelPostFilterInput, $limit: Int, $nextToken: String) {
    listPosts(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        ...PostFields
      }
      nextToken
    }
  }
`

export interface ListPostsArgs {
  status?: 'draft' | 'published' | 'all'
  limit?: number
  nextToken?: string
}

export const listPostsSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['draft', 'published', 'all'],
      description: 'Filter by status (default "all")',
    },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20)' },
    nextToken: { type: 'string', description: 'Pagination cursor from a previous call' },
  },
} as const

export async function listPosts(client: GraphqlClient, args: ListPostsArgs = {}) {
  const status = args.status ?? 'all'
  const filter: Record<string, unknown> = {}
  if (status !== 'all') filter.status = { eq: status }
  const hasFilter = Object.keys(filter).length > 0

  const data = await client.query<{
    listPosts: { items: Parameters<typeof toCorePost>[0][]; nextToken: string | null }
  }>(QUERY, {
    filter: hasFilter ? filter : undefined,
    limit: args.limit ?? 20,
    nextToken: args.nextToken,
  })

  return {
    posts: data.listPosts.items.map(toCorePost),
    nextToken: data.listPosts.nextToken,
  }
}
