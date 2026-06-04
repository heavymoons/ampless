import {
  encodeAwsJson,
  type Post,
  type PostMetadata,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { normalizePublishedAt } from './published-at.js'

const MUTATION = /* GraphQL */ `
  ${POST_FIELDS}
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ...PostFields
    }
  }
`

export interface CreatePostArgs {
  postId?: string
  slug: string
  title: string
  format: 'tiptap' | 'markdown' | 'html'
  body: unknown
  status?: 'draft' | 'published'
  excerpt?: string
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata | Record<string, unknown>
}

export const createPostSchema = {
  type: 'object',
  required: ['slug', 'title', 'format', 'body'],
  properties: {
    postId: { type: 'string', description: 'Optional explicit id; auto-generated if omitted' },
    slug: { type: 'string' },
    title: { type: 'string' },
    format: {
      type: 'string',
      enum: ['tiptap', 'markdown', 'html'],
      description:
        'tiptap = rich text JSON tree; markdown = source string (GFM extensions enabled); html = raw HTML string (rendered verbatim, no sanitization).',
    },
    body: {
      description:
        'tiptap JSON (when format=tiptap), markdown source string (format=markdown), or raw HTML string (format=html).',
    },
    status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
    excerpt: { type: 'string' },
    publishedAt: { type: 'string', description: 'ISO 8601 timestamp; required when status=published' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: {
      type: 'object',
      description:
        'Free-form per-post metadata. Reserved well-known keys: `no_layout` (boolean) — when true, the public page is served as bare HTML with no theme chrome (middleware rewrites /<slug> to the internal bare-HTML route); meaningful only with format=html. `cache` (auto|deep|hot) — override the per-post cache strategy. See `cacheStrategy` in get_schema.notes for details. Other keys pass through unchanged for themes/plugins.',
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
      },
      additionalProperties: true,
    },
  },
} as const

export async function createPost(
  client: GraphqlClient,
  args: CreatePostArgs
): Promise<Post> {
  const postId =
    args.postId ?? `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const status = args.status ?? 'draft'
  // Normalize an explicit publishedAt to canonical UTC Z form (required for
  // lexical GSI sort + AppSync resolver `<= now` comparison). When none is
  // provided, default to now for published posts; leave undefined for drafts.
  const publishedAt = args.publishedAt !== undefined
    ? normalizePublishedAt(args.publishedAt)
    : (status === 'published' ? new Date().toISOString() : undefined)

  const data = await client.query<{
    createPost: Parameters<typeof toCorePost>[0]
  }>(MUTATION, {
    input: {
      postId,
      slug: args.slug,
      title: args.title,
      excerpt: args.excerpt,
      format: args.format,
      body: encodeAwsJson(args.body),
      status,
      publishedAt,
      tags: args.tags,
      metadata: args.metadata !== undefined ? encodeAwsJson(args.metadata) : undefined,
    },
  })

  // PostTag denormalized index is rebuilt by the trusted-processor
  // Lambda from the Post DynamoDB stream (see
  // packages/backend/src/events/processor-trusted.ts `rebuildPostTagsForPost`).
  // No client-side sync needed — the write completing here is enough.
  return toCorePost(data.createPost)
}
