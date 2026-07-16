import type { ToolDefinition } from '../tools/index.js'
import type { PublicToolContext } from './types.js'
import { toPublicSummary } from './types.js'
import { clampInt, validateCursor, MAX_CURSOR_LEN } from './shared.js'

const DEFAULT_LIMIT = 20
const MIN_LIMIT = 1
const MAX_LIMIT = 50

const listPostsSchema = {
  type: 'object',
  properties: {
    limit: {
      type: 'integer',
      minimum: MIN_LIMIT,
      maximum: MAX_LIMIT,
      description: `Max posts to return (${MIN_LIMIT}–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`,
    },
    cursor: {
      type: 'string',
      maxLength: MAX_CURSOR_LEN,
      description: 'Opaque pagination cursor from a previous call (`nextCursor`)',
    },
  },
} as const

/**
 * Public `list_posts`: one page of newest-first published-post
 * summaries plus an opaque `nextCursor` for the next page. Read-only;
 * published posts only. Does not scan — a single backend page read.
 */
export const listPostsTool: ToolDefinition<PublicToolContext> = {
  name: 'list_posts',
  description:
    'List published posts, newest first (read-only, published posts only). Returns lightweight ' +
    'summaries (no body — use get_post for content) and an opaque `nextCursor` for pagination. ' +
    'Args: `limit` (1–50, default 20), `cursor` (from a previous response).',
  inputSchema: listPostsSchema,
  readOnly: true,
  destructive: false,
  handler: async (args, ctx) => {
    const limit = clampInt(args.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT)
    const cursor = validateCursor(args.cursor)
    const { items, nextToken } = await ctx.listPublishedPosts({ limit, nextToken: cursor })
    return {
      posts: items.map(toPublicSummary),
      nextCursor: nextToken,
    }
  },
}
