import {
  composeSiteIdStatus,
  composeSiteIdSlug,
  encodeAwsJson,
  type Post,
  type PostMetadata,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { syncPostTags } from '../posttag.js'

const MUTATION = /* GraphQL */ `
  ${POST_FIELDS}
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ...PostFields
    }
  }
`

export interface CreatePostArgs {
  siteId?: string
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
    siteId: { type: 'string', description: 'Site identifier (defaults to "default")' },
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
        'Free-form per-post metadata. Reserved well-known keys: `no_layout` (boolean) — when true, the public page is served as bare HTML with no theme chrome (the route redirects to /_/<slug>); meaningful only with format=html. Other keys pass through unchanged for themes/plugins.',
      properties: {
        no_layout: {
          type: 'boolean',
          description:
            'Serve the post as bare HTML with no theme chrome. Only meaningful when format=html; ignored otherwise.',
        },
      },
      additionalProperties: true,
    },
  },
} as const

export async function createPost(
  client: GraphqlClient,
  defaultSiteId: string,
  args: CreatePostArgs
): Promise<Post> {
  const siteId = args.siteId ?? defaultSiteId
  const postId =
    args.postId ?? `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const status = args.status ?? 'draft'
  const publishedAt =
    args.publishedAt ?? (status === 'published' ? new Date().toISOString() : undefined)

  const data = await client.query<{
    createPost: Parameters<typeof toCorePost>[0]
  }>(MUTATION, {
    input: {
      siteId,
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
      // Denormalized GSI keys.
      siteIdStatus: composeSiteIdStatus(siteId, status),
      siteIdSlug: composeSiteIdSlug(siteId, args.slug),
    },
  })

  const created = toCorePost(data.createPost)
  await syncPostTags(client, created, null)
  return created
}
