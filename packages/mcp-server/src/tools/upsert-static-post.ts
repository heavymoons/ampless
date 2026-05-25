import {
  encodeAwsJson,
  type Post,
  type PostMetadata,
  type StaticPostBody,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { getPost } from './get-post.js'

// PostTag denormalized index is rebuilt by the trusted-processor
// Lambda directly off the Post DynamoDB stream — see
// packages/backend/src/events/processor-trusted.ts
// `rebuildPostTagsForPost`. No client-side sync needed.

/**
 * Shared "find Post by slug → create if absent, otherwise update"
 * helper for the static-bundle tools. Both `upload_static_bundle` and
 * `commit_static_post` need to coordinate a Post row with a freshly
 * written S3 manifest, and duplicating the create-vs-update branching
 * in each handler ended up with subtle drift. Centralised here.
 *
 * For new posts a `title` is required (Post schema enforces it). For
 * existing posts every field is optional — the helper merges only the
 * keys the caller passed.
 */

const CREATE_MUTATION = /* GraphQL */ `
  ${POST_FIELDS}
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ...PostFields
    }
  }
`

const UPDATE_MUTATION = /* GraphQL */ `
  ${POST_FIELDS}
  mutation UpdatePost($input: UpdatePostInput!) {
    updatePost(input: $input) {
      ...PostFields
    }
  }
`

export interface UpsertStaticPostFields {
  /** Required when creating a new post; ignored on update unless provided. */
  title?: string
  /** Override the auto-generated post id when creating. */
  postId?: string
  excerpt?: string
  status?: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata | Record<string, unknown>
}

export interface UpsertStaticPostResult {
  post: Post
  /** True when a new Post row was created, false on update. */
  created: boolean
}

export async function upsertStaticPost(
  graphql: GraphqlClient,
  slug: string,
  body: StaticPostBody,
  fields: UpsertStaticPostFields,
): Promise<UpsertStaticPostResult> {
  const existing = await getPost(graphql, { slug })

  if (existing) {
    // UPDATE path — only apply fields the caller passed.
    const input: Record<string, unknown> = {
      postId: existing.postId,
      format: 'static',
      body: encodeAwsJson(body),
    }
    if (fields.title !== undefined) input.title = fields.title
    if (fields.excerpt !== undefined) input.excerpt = fields.excerpt
    if (fields.status !== undefined) input.status = fields.status
    if (fields.publishedAt !== undefined) input.publishedAt = fields.publishedAt
    if (fields.tags !== undefined) input.tags = fields.tags
    if (fields.metadata !== undefined) {
      input.metadata = encodeAwsJson(fields.metadata)
    }

    const data = await graphql.query<{
      updatePost: Parameters<typeof toCorePost>[0]
    }>(UPDATE_MUTATION, { input })

    const updated = toCorePost(data.updatePost)
    return { post: updated, created: false }
  }

  // CREATE path — title is mandatory.
  if (!fields.title) {
    throw new Error(
      `commit_static_post: cannot create a new post at slug "${slug}" without a title. ` +
        `Pass \`title\` or commit against an existing post.`,
    )
  }

  const status = fields.status ?? 'draft'
  const publishedAt =
    fields.publishedAt ??
    (status === 'published' ? new Date().toISOString() : undefined)
  const postId =
    fields.postId ?? `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const input: Record<string, unknown> = {
    postId,
    slug,
    title: fields.title,
    format: 'static',
    body: encodeAwsJson(body),
    status,
  }
  if (fields.excerpt !== undefined) input.excerpt = fields.excerpt
  if (publishedAt !== undefined) input.publishedAt = publishedAt
  if (fields.tags !== undefined) input.tags = fields.tags
  if (fields.metadata !== undefined) input.metadata = encodeAwsJson(fields.metadata)

  const data = await graphql.query<{
    createPost: Parameters<typeof toCorePost>[0]
  }>(CREATE_MUTATION, { input })

  const created = toCorePost(data.createPost)
  return { post: created, created: true }
}
