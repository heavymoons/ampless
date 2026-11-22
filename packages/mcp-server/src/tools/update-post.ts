import {
  encodeAwsJson,
  type Post,
  type PostMetadata,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { normalizePublishedAt } from './published-at.js'
import { getPost } from './get-post.js'
import { mergePostClasses, postClassesSchema, validatePostClassesArgs } from './post-classes.js'

const MUTATION = /* GraphQL */ `
  ${POST_FIELDS}
  mutation UpdatePost($input: UpdatePostInput!) {
    updatePost(input: $input) {
      ...PostFields
    }
  }
`

export interface UpdatePostArgs {
  postId: string
  slug?: string
  title?: string
  excerpt?: string
  format?: 'tiptap' | 'markdown' | 'html'
  body?: unknown
  status?: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata | Record<string, unknown>
  /**
   * Theme post class ids. Without `metadata`, merged into the post's
   * current metadata (other keys kept); with `metadata`, put into it.
   */
  postClasses?: string[]
}

export const updatePostSchema = {
  type: 'object',
  required: ['postId'],
  properties: {
    postId: { type: 'string' },
    slug: { type: 'string' },
    title: { type: 'string' },
    excerpt: { type: 'string' },
    format: {
      type: 'string',
      enum: ['tiptap', 'markdown', 'html'],
      description:
        'tiptap = rich text JSON tree; markdown = source string; html = raw HTML string (no sanitization).',
    },
    body: {
      type: ['object', 'array', 'string'],
      description:
        'tiptap JSON (when format=tiptap; pass a JSON object/array, NOT a stringified string), markdown source, or raw HTML string',
    },
    status: { type: 'string', enum: ['draft', 'published'] },
    publishedAt: { type: 'string', description: 'ISO 8601 timestamp' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: {
      type: 'object',
      description:
        'Free-form per-post metadata. Reserved well-known keys: `no_layout` (boolean) — when true, the public page is served as bare HTML with no theme chrome (middleware rewrites /<slug> to the internal bare-HTML route); meaningful only with format=html. `cache` (auto|deep|hot) — override the per-post cache strategy. See `cacheStrategy` in get_schema.notes for details. `postClasses` (string[]) — theme-defined post class ids, rendered as `ampless-post--<id>` on the post body wrapper; prefer the top-level `postClasses` arg. Passing metadata replaces the existing metadata object — read the current post first if you only want to add a key (or use the top-level `postClasses` arg, which merges).',
      properties: {
        no_layout: {
          type: 'boolean',
          description:
            'Serve the post as bare HTML with no theme chrome. Only meaningful when format=html; ignored otherwise.',
        },
        cache: {
          type: 'string',
          enum: ['auto', 'deep', 'hot'],
          default: 'auto',
          description:
            "Override the response Cache-Control strategy. 'auto' (default): no-store within `cms.config.cache.cooldownMs` of updatedAt, then `max-age=freshTtlSeconds`. 'deep': always `max-age=deepTtlSeconds`. 'hot': always no-store. Independent of no_layout; applies uniformly to themed, no_layout, and static posts.",
        },
        postClasses: postClassesSchema,
      },
      additionalProperties: true,
    },
    postClasses: {
      ...postClassesSchema,
      description: `${postClassesSchema.description} Without \`metadata\`, this is merged into the post's current metadata (other keys such as cache, no_layout and plugin keys are kept); with \`metadata\`, it is put into that object. An empty array removes the post classes.`,
    },
  },
} as const

export async function updatePost(
  client: GraphqlClient,
  args: UpdatePostArgs
): Promise<Post> {
  // Validate before any read or write: invalid ids are rejected, not dropped.
  const postClasses = validatePostClassesArgs(args)

  // The current row, read at most once (post classes merge and the
  // publishedAt read-then-fill below can both need it).
  let existing: Post | null | undefined
  const loadExisting = async (): Promise<Post | null> => {
    if (existing === undefined) existing = await getPost(client, { postId: args.postId })
    return existing
  }

  const input: Record<string, unknown> = { postId: args.postId }
  if (args.slug !== undefined) input.slug = args.slug
  if (args.title !== undefined) input.title = args.title
  if (args.excerpt !== undefined) input.excerpt = args.excerpt
  if (args.format !== undefined) input.format = args.format
  if (args.body !== undefined) input.body = encodeAwsJson(args.body)
  if (args.status !== undefined) input.status = args.status
  // Normalize an explicit publishedAt to canonical UTC Z form so the GSI
  // sort and AppSync `<= now` comparisons use fixed-width lexical ordering.
  if (args.publishedAt !== undefined) {
    input.publishedAt = normalizePublishedAt(args.publishedAt)
  }
  if (args.tags !== undefined) input.tags = args.tags
  // `metadata` replaces the stored object wholesale. A top-level
  // `postClasses` without `metadata` must not erase the other keys
  // (cache, no_layout, plugin state), so merge into the current row.
  let metadata = args.metadata
  if (postClasses !== undefined && metadata === undefined) {
    const current = await loadExisting()
    if (!current) throw new Error(`Post not found: ${args.postId}`)
    metadata = current.metadata ?? {}
  }
  metadata = mergePostClasses(metadata, postClasses)
  if (metadata !== undefined) input.metadata = encodeAwsJson(metadata)

  // Read-then-fill: when transitioning to `published` without an explicit
  // publishedAt, ensure the row always carries one (required for the GSI
  // sort key and AppSync resolver visibility check). Fetch the existing row
  // and fill now only if it has no publishedAt yet. Never overwrite an
  // existing publishedAt (e.g. a scheduled future date the caller set earlier).
  if (args.status === 'published' && args.publishedAt === undefined) {
    const current = await loadExisting()
    if (current && !current.publishedAt) {
      input.publishedAt = new Date().toISOString()
    }
  }

  const data = await client.query<{
    updatePost: Parameters<typeof toCorePost>[0]
  }>(MUTATION, { input })

  // PostTag denormalized index is rebuilt by the trusted-processor
  // Lambda from the Post DynamoDB stream — the post write here is
  // enough to trigger it, no need to snapshot the old post first.
  return toCorePost(data.updatePost)
}
