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
import { getPost } from './get-post.js'

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
  siteId?: string
  slug?: string
  title?: string
  excerpt?: string
  format?: 'tiptap' | 'markdown' | 'html'
  body?: unknown
  status?: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata | Record<string, unknown>
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
    body: { description: 'tiptap JSON, markdown source, or raw HTML string' },
    status: { type: 'string', enum: ['draft', 'published'] },
    publishedAt: { type: 'string', description: 'ISO 8601 timestamp' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: {
      type: 'object',
      description:
        'Free-form per-post metadata. Reserved well-known keys: `no_layout` (boolean) — when true, the public page is served as bare HTML with no theme chrome (the route redirects to /_/<slug>); meaningful only with format=html. Passing metadata replaces the existing metadata object — read the current post first if you only want to add a key.',
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

export async function updatePost(
  client: GraphqlClient,
  defaultSiteId: string,
  args: UpdatePostArgs
): Promise<Post> {
  const siteId = args.siteId ?? defaultSiteId

  // Snapshot the old post so PostTag diff is correct.
  const oldPost = await getPost(client, defaultSiteId, { postId: args.postId, siteId })

  const input: Record<string, unknown> = { siteId, postId: args.postId }
  if (args.slug !== undefined) input.slug = args.slug
  if (args.title !== undefined) input.title = args.title
  if (args.excerpt !== undefined) input.excerpt = args.excerpt
  if (args.format !== undefined) input.format = args.format
  if (args.body !== undefined) input.body = encodeAwsJson(args.body)
  if (args.status !== undefined) input.status = args.status
  if (args.publishedAt !== undefined) input.publishedAt = args.publishedAt
  if (args.tags !== undefined) input.tags = args.tags
  if (args.metadata !== undefined) input.metadata = encodeAwsJson(args.metadata)
  // Recompute the denormalized GSI keys whenever status / slug changes.
  if (args.status !== undefined) {
    input.siteIdStatus = composeSiteIdStatus(siteId, args.status)
  }
  if (args.slug !== undefined) {
    input.siteIdSlug = composeSiteIdSlug(siteId, args.slug)
  }

  const data = await client.query<{
    updatePost: Parameters<typeof toCorePost>[0]
  }>(MUTATION, { input })

  const updated = toCorePost(data.updatePost)
  await syncPostTags(client, updated, oldPost)
  return updated
}
