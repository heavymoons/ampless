import type { ToolDefinition } from '../tools/index.js'
import type { PublicToolContext } from './types.js'
import { scanRecentPublished } from './shared.js'

const listTagsSchema = {
  type: 'object',
  properties: {},
} as const

/**
 * Public `list_tags`: aggregate tag counts over a bounded scan of recent
 * published posts, sorted by descending count (ties broken
 * alphabetically for a stable order). Read-only; published posts only.
 * `scanTruncated: true` means the counts cover only the scan window.
 */
export const listTagsTool: ToolDefinition<PublicToolContext> = {
  name: 'list_tags',
  description:
    'List tags used by published posts with occurrence counts, most frequent first (read-only, ' +
    'published posts only). Aggregated over a bounded scan of the most recent posts. Returns ' +
    '`{ tags: [{ tag, count }], scanTruncated }`; `scanTruncated: true` means counts cover only ' +
    'the scan window.',
  inputSchema: listTagsSchema,
  readOnly: true,
  destructive: false,
  handler: async (_args, ctx) => {
    const { posts, scanTruncated } = await scanRecentPublished(ctx)

    const counts = new Map<string, number>()
    for (const post of posts) {
      for (const tag of post.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }

    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))

    return { tags, scanTruncated }
  },
}
