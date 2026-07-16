import type { Post } from 'ampless'
import type { ToolDefinition } from '../tools/index.js'
import type { PublicToolContext } from './types.js'
import { toPublicSummary } from './types.js'
import { clampInt, validateQuery, scanRecentPublished, MAX_QUERY_LEN } from './shared.js'

const DEFAULT_LIMIT = 10
const MIN_LIMIT = 1
const MAX_LIMIT = 20

const searchPostsSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_QUERY_LEN,
      description: 'Case-insensitive substring matched against title / slug / tags / excerpt',
    },
    limit: {
      type: 'integer',
      minimum: MIN_LIMIT,
      maximum: MAX_LIMIT,
      description: `Max matches to return (${MIN_LIMIT}–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`,
    },
  },
  required: ['query'],
} as const

/** Case-insensitive substring match over title / slug / tags / excerpt (not body). */
function matchesQuery(post: Post, needle: string): boolean {
  const haystacks: string[] = [post.title, post.slug]
  if (post.excerpt) haystacks.push(post.excerpt)
  if (post.tags) haystacks.push(...post.tags)
  return haystacks.some((h) => h.toLowerCase().includes(needle))
}

/**
 * Public `search_posts`: substring search over a bounded scan of recent
 * published posts. Read-only; published posts only. Matches title /
 * slug / tags / excerpt (body is out of scope for this phase).
 * `scanTruncated: true` means the scan didn't reach the whole archive.
 */
export const searchPostsTool: ToolDefinition<PublicToolContext> = {
  name: 'search_posts',
  description:
    'Search published posts by case-insensitive substring over title / slug / tags / excerpt ' +
    '(read-only, published posts only; body text is not searched). Scans a bounded window of the ' +
    'most recent posts. Args: `query` (required, 1–256 chars), `limit` (1–20, default 10). ' +
    '`scanTruncated: true` means older posts were beyond the scan window.',
  inputSchema: searchPostsSchema,
  readOnly: true,
  destructive: false,
  handler: async (args, ctx) => {
    const query = validateQuery(args.query)
    const limit = clampInt(args.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT)
    const needle = query.toLowerCase()

    const { posts, scanTruncated } = await scanRecentPublished(ctx)
    const matches = posts.filter((post) => matchesQuery(post, needle)).slice(0, limit)

    return {
      posts: matches.map(toPublicSummary),
      scanTruncated,
    }
  },
}
