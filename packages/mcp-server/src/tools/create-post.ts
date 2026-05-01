import type { Post } from 'ampless'
import type { GraphqlClient } from '../appsync.js'
import { POST_FIELDS, encodeBody, toCorePost } from './post-mapping.js'
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
}

export const createPostSchema = {
  type: 'object',
  required: ['slug', 'title', 'format', 'body'],
  properties: {
    siteId: { type: 'string', description: 'Site identifier (defaults to "default")' },
    postId: { type: 'string', description: 'Optional explicit id; auto-generated if omitted' },
    slug: { type: 'string' },
    title: { type: 'string' },
    format: { type: 'string', enum: ['tiptap', 'markdown', 'html'] },
    body: {
      description:
        'tiptap JSON (when format=tiptap), markdown source string, or raw HTML string',
    },
    status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
    excerpt: { type: 'string' },
    publishedAt: { type: 'string', description: 'ISO 8601 timestamp; required when status=published' },
    tags: { type: 'array', items: { type: 'string' } },
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
      body: encodeBody(args.body),
      status,
      publishedAt,
      tags: args.tags,
    },
  })

  const created = toCorePost(data.createPost)
  await syncPostTags(client, created, null)
  return created
}
