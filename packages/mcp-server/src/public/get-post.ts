import type { ToolDefinition } from '../tools/index.js'
import type { PublicToolContext } from './types.js'
import { toPublicSummary } from './types.js'
import { validateSlug, MAX_BODY_CHARS, MAX_SLUG_LEN } from './shared.js'

const getPostSchema = {
  type: 'object',
  properties: {
    slug: {
      type: 'string',
      maxLength: MAX_SLUG_LEN,
      description: 'Slug of the published post to fetch',
    },
    frontmatter: {
      type: 'boolean',
      description: 'Include YAML frontmatter in the markdown (default true)',
    },
  },
  required: ['slug'],
} as const

/**
 * Public `get_post`: a single published post by slug, with its body
 * rendered to markdown via the injected `postToMarkdown`. Read-only;
 * published posts only. Markdown longer than `MAX_BODY_CHARS` is
 * truncated with a `truncated: true` flag.
 */
export const getPostTool: ToolDefinition<PublicToolContext> = {
  name: 'get_post',
  description:
    'Fetch a single published post by slug (read-only, published posts only). Returns the ' +
    'summary fields plus the post body rendered to `markdown`. Args: `slug` (required), ' +
    '`frontmatter` (default true). Errors if no published post matches the slug. Very long ' +
    'bodies are truncated (`truncated: true`).',
  inputSchema: getPostSchema,
  readOnly: true,
  destructive: false,
  handler: async (args, ctx) => {
    const slug = validateSlug(args.slug)
    const frontmatter = typeof args.frontmatter === 'boolean' ? args.frontmatter : true

    const post = await ctx.getPublishedPost(slug)
    if (!post) {
      throw new Error(`No published post found for slug: ${slug}`)
    }

    const summary = toPublicSummary(post)
    const rendered = await ctx.postToMarkdown(post, { frontmatter })
    const truncated = rendered.length > MAX_BODY_CHARS
    const markdown = truncated ? rendered.slice(0, MAX_BODY_CHARS) : rendered

    // `summary` is already the allowlisted object (built by
    // `toPublicSummary`), so spreading it here can only surface those
    // fields — no `Post` is spread.
    return { ...summary, markdown, truncated }
  },
}
