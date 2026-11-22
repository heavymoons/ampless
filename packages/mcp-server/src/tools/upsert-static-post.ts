import {
  encodeAwsJson,
  type Post,
  type PostMetadata,
  type StaticPostBody,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { getPost } from './get-post.js'
import { normalizePublishedAt } from './published-at.js'
import { isConditionalCheckFailed } from './update-post.js'

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
  mutation UpdatePost($input: UpdatePostInput!, $condition: ModelPostConditionInput) {
    updatePost(input: $input, condition: $condition) {
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

export interface UpsertStaticPostOptions {
  /**
   * The row at `slug` as the caller already read it (`null` = none).
   * When given, the helper does not read again, and an update is a
   * compare-and-swap on this row's `updatedAt`: if the post changed since
   * that read, nothing is written and `StaticPostConflictError` is thrown.
   */
  existing?: Post | null
}

/** The post changed between the caller's read and the conditional write. */
export class StaticPostConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaticPostConflictError'
  }
}

export interface UpsertStaticPostResult {
  post: Post
  /** True when a new Post row was created, false on update. */
  created: boolean
  /** The row this write replaced (`null` when one was created). */
  previous: Post | null
}

export async function upsertStaticPost(
  graphql: GraphqlClient,
  slug: string,
  body: StaticPostBody,
  fields: UpsertStaticPostFields,
  options: UpsertStaticPostOptions = {},
): Promise<UpsertStaticPostResult> {
  const conditional = options.existing !== undefined
  const existing = conditional ? options.existing! : await getPost(graphql, { slug })

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
    // Normalize an explicit publishedAt to canonical UTC Z form.
    if (fields.publishedAt !== undefined) {
      input.publishedAt = normalizePublishedAt(fields.publishedAt)
    }
    if (fields.tags !== undefined) input.tags = fields.tags
    if (fields.metadata !== undefined) {
      input.metadata = encodeAwsJson(fields.metadata)
    }

    // Read-then-fill: when the effective status is `published` and no
    // publishedAt was provided, fill now only if the existing row lacks one.
    // Never overwrite an existing publishedAt (e.g. a scheduled future date).
    const effectiveStatus = fields.status ?? existing.status
    if (effectiveStatus === 'published' && fields.publishedAt === undefined && !existing.publishedAt) {
      input.publishedAt = new Date().toISOString()
    }

    let data: { updatePost: Parameters<typeof toCorePost>[0] }
    if (conditional) {
      const condition = existing.updatedAt
        ? { updatedAt: { eq: existing.updatedAt } }
        : { updatedAt: { attributeExists: false } }
      try {
        data = await graphql.query(UPDATE_MUTATION, { input, condition })
      } catch (err) {
        if (isConditionalCheckFailed(err)) {
          throw new StaticPostConflictError(
            `Post at slug "${slug}" was modified by someone else while its static bundle was being saved; nothing was written.`,
          )
        }
        throw err
      }
    } else {
      data = await graphql.query(UPDATE_MUTATION, { input })
    }

    const updated = toCorePost(data.updatePost)
    return { post: updated, created: false, previous: existing }
  }

  // CREATE path — title is mandatory.
  if (!fields.title) {
    throw new Error(
      `commit_static_post: cannot create a new post at slug "${slug}" without a title. ` +
        `Pass \`title\` or commit against an existing post.`,
    )
  }

  const status = fields.status ?? 'draft'
  // Normalize an explicit publishedAt; otherwise default to now for
  // published posts (leave undefined for drafts).
  const publishedAt = fields.publishedAt !== undefined
    ? normalizePublishedAt(fields.publishedAt)
    : (status === 'published' ? new Date().toISOString() : undefined)
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
  return { post: created, created: true, previous: null }
}
