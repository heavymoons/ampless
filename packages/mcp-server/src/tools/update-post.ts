import {
  encodeAwsJson,
  postClassesMetadataError,
  ConditionalPostUpdateUnsupportedError,
  PostUpdateConflictError,
  type PostMetadata,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { normalizePublishedAt } from './published-at.js'
import { getPost } from './get-post.js'
import { MISSING_MUTATION_MESSAGE, expectedFrom, updatePostIfUnchanged } from './conditional-update.js'
import { postVersion, withVersion, type VersionedPost } from './post-version.js'

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
   * The `version` from get_post. When set, the tool re-reads the post,
   * fails with a conflict unless that read's content version still equals
   * this value, and writes through the atomic `amplessUpdatePostIfUnchanged`
   * mutation conditioned on every field of that read (see `updatePost`).
   */
  expectedVersion?: string
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
        'Free-form per-post metadata. Reserved well-known keys: `no_layout` (boolean) — when true, the public page is served as bare HTML with no theme chrome (middleware rewrites /<slug> to the internal bare-HTML route); meaningful only with format=html. `cache` (auto|deep|hot) — override the per-post cache strategy. See `cacheStrategy` in get_schema.notes for details. `ampless:postClasses` — theme post classes (see get_schema.notes.postClasses; prefer set_post_classes). Passing metadata replaces the existing metadata object — read the current post first if you only want to add a key, and pass its `version` as `expectedVersion` so a concurrent change is not overwritten.',
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
    expectedVersion: {
      type: 'string',
      description:
        "Optional optimistic-concurrency guard: the `version` returned by get_post (a hash of the post's content, not just its updatedAt). The tool re-reads the post and fails with a conflict (nothing written) unless the re-read's version still equals this value; it then writes atomically, conditioned on every field of that re-read. So the update never overwrites a change made after the read you took the version from — including one made in the same millisecond, which leaves updatedAt unchanged. On a conflict, re-read with get_post, re-apply your change, and retry with the new version. Requires a backend with the amplessUpdatePostIfUnchanged mutation (`create-ampless upgrade`); otherwise the call fails and nothing is saved. Omit for the default unguarded last-write-wins update.",
    },
  },
} as const

/**
 * Without `expectedVersion`: the stock unconditional `updatePost`
 * (last-write-wins; unguarded against concurrent edits — unchanged).
 *
 * With `expectedVersion`: read the post fresh; conflict unless that read's
 * content version equals the caller's. A match means the fresh read IS the
 * content the caller saw, so `amplessUpdatePostIfUnchanged` with patch =
 * the provided fields and expected = every field of that read atomically
 * guards the rest of the window, up to the write. Because the version
 * hashes the content, a change between the caller's read and this one is
 * caught even when it left updatedAt unchanged (same millisecond).
 */
export async function updatePost(
  client: GraphqlClient,
  args: UpdatePostArgs
): Promise<VersionedPost> {
  if (args.expectedVersion !== undefined && (typeof args.expectedVersion !== 'string' || !args.expectedVersion)) {
    throw new Error('update_post: `expectedVersion` must be a non-empty string (the post\'s `version` from get_post)')
  }
  // A tagged post-classes value the caller supplies must carry valid ids
  // (the renderer would drop invalid ones silently — reject the typo here).
  if (args.metadata !== undefined) {
    const postClassesError = postClassesMetadataError(args.metadata)
    if (postClassesError) throw new Error(`update_post: ${postClassesError}`)
  }
  // Normalize an explicit publishedAt to canonical UTC Z form so the GSI
  // sort and AppSync `<= now` comparisons use fixed-width lexical ordering.
  const publishedAt = args.publishedAt !== undefined ? normalizePublishedAt(args.publishedAt) : undefined

  if (args.expectedVersion !== undefined) {
    return updatePostConditionally(client, args, publishedAt, args.expectedVersion)
  }

  const input: Record<string, unknown> = { postId: args.postId }
  if (args.slug !== undefined) input.slug = args.slug
  if (args.title !== undefined) input.title = args.title
  if (args.excerpt !== undefined) input.excerpt = args.excerpt
  if (args.format !== undefined) input.format = args.format
  if (args.body !== undefined) input.body = encodeAwsJson(args.body)
  if (args.status !== undefined) input.status = args.status
  if (publishedAt !== undefined) input.publishedAt = publishedAt
  if (args.tags !== undefined) input.tags = args.tags
  if (args.metadata !== undefined) input.metadata = encodeAwsJson(args.metadata)

  // Read-then-fill: when transitioning to `published` without an explicit
  // publishedAt, ensure the row always carries one (required for the GSI
  // sort key and AppSync resolver visibility check). Fetch the existing row
  // and fill now only if it has no publishedAt yet. Never overwrite an
  // existing publishedAt (e.g. a scheduled future date the caller set earlier).
  if (args.status === 'published' && args.publishedAt === undefined) {
    const existing = await getPost(client, { postId: args.postId })
    if (existing && !existing.publishedAt) {
      input.publishedAt = new Date().toISOString()
    }
  }

  const data = await client.query<{ updatePost: Parameters<typeof toCorePost>[0] }>(MUTATION, { input })

  // PostTag denormalized index is rebuilt by the trusted-processor
  // Lambda from the Post DynamoDB stream — the post write here is
  // enough to trigger it, no need to snapshot the old post first.
  return withVersion(toCorePost(data.updatePost))
}

function conflictError(postId: string, expectedVersion: string, cause?: unknown): Error {
  return new Error(
    `update_post: conflict — post ${postId} is no longer at version ${expectedVersion} ` +
      '(it was changed or deleted since you read it). Nothing was saved. ' +
      'Call get_post to re-read it, re-apply your change, and retry with the new version.',
    cause === undefined ? undefined : { cause },
  )
}

async function updatePostConditionally(
  client: GraphqlClient,
  args: UpdatePostArgs,
  publishedAt: string | undefined,
  expectedVersion: string,
): Promise<VersionedPost> {
  // Native values: the resolver marshals them like the stock resolver
  // stores AWSJSON, so body / metadata are NOT encoded here.
  const patch: Record<string, unknown> = {}
  if (args.slug !== undefined) patch.slug = args.slug
  if (args.title !== undefined) patch.title = args.title
  if (args.excerpt !== undefined) patch.excerpt = args.excerpt
  if (args.format !== undefined) patch.format = args.format
  if (args.body !== undefined) patch.body = args.body
  if (args.status !== undefined) patch.status = args.status
  if (publishedAt !== undefined) patch.publishedAt = publishedAt
  if (args.tags !== undefined) patch.tags = args.tags
  if (args.metadata !== undefined) patch.metadata = args.metadata
  if (Object.keys(patch).length === 0) {
    throw new Error('update_post: pass at least one field to change together with `expectedVersion`')
  }

  const fresh = await getPost(client, { postId: args.postId })
  // Compare the content version, not updatedAt: a write in the same
  // millisecond leaves updatedAt equal but changes the version. On a match
  // this read is exactly what the caller saw, and the conditional write
  // below guards the remaining window up to the write.
  if (!fresh || postVersion(fresh) !== expectedVersion) throw conflictError(args.postId, expectedVersion)
  if (!fresh.updatedAt) {
    // The conditional mutation needs an updatedAt to condition on.
    throw new Error(
      `update_post: post ${args.postId} has no updatedAt, so the change cannot be written safely; nothing was saved`,
    )
  }
  // Same publishedAt fill as the unconditional path, decided on the read
  // the write is conditioned on.
  if (args.status === 'published' && args.publishedAt === undefined && !fresh.publishedAt) {
    patch.publishedAt = new Date().toISOString()
  }

  try {
    return await updatePostIfUnchanged(client, args.postId, patch, expectedFrom(fresh))
  } catch (err) {
    if (err instanceof PostUpdateConflictError) throw conflictError(args.postId, expectedVersion, err)
    if (err instanceof ConditionalPostUpdateUnsupportedError) {
      throw new Error(`update_post: ${MISSING_MUTATION_MESSAGE}`, { cause: err })
    }
    throw err
  }
}
