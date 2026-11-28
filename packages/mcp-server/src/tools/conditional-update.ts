import {
  ConditionalPostUpdateUnsupportedError,
  PostUpdateConflictError,
  type Post,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'
import { isConditionalCheckFailed, isConditionalMutationMissing } from './graphql-errors.js'
import { withVersion, type VersionedPost } from './post-version.js'

// The atomic conditional update (templates/_shared/amplify/data/
// update-post-if-unchanged.js): one DynamoDB UpdateItem that writes `patch`
// only if the row still holds `expected.updatedAt` AND every other field in
// `expected`. Field comparison (not just updatedAt) is what catches a write
// in the same millisecond, which leaves updatedAt unchanged.
const MUTATION = /* GraphQL */ `
  ${POST_FIELDS}
  mutation AmplessUpdatePostIfUnchanged($postId: ID!, $patch: String!, $expected: String!) {
    amplessUpdatePostIfUnchanged(postId: $postId, patch: $patch, expected: $expected) {
      ...PostFields
    }
  }
`

export const MISSING_MUTATION_MESSAGE =
  'the backend lacks the amplessUpdatePostIfUnchanged mutation; run `create-ampless upgrade` and redeploy. Nothing was saved.'

/** Every field the resolver can patch and condition on. */
export const CONDITIONED_FIELDS = [
  'title',
  'slug',
  'excerpt',
  'format',
  'body',
  'status',
  'publishedAt',
  'tags',
  'metadata',
] as const

export type ConditionedField = (typeof CONDITIONED_FIELDS)[number]

/**
 * `expected` for the given fields of a post as `toCorePost` produced it:
 * absent values become `null` (JSON would drop `undefined`), plus its
 * `updatedAt`. Pass the post exactly as read — the resolver mirrors the
 * mapper's collapsing (null format → 'markdown', etc.).
 */
export function expectedFrom(
  post: Post,
  fields: readonly ConditionedField[] = CONDITIONED_FIELDS,
): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: post.updatedAt }
  for (const field of fields) out[field] = post[field] ?? null
  return out
}

/**
 * Run `amplessUpdatePostIfUnchanged`. `patch` holds native values (body /
 * metadata NOT AWSJSON-encoded; `null` removes a nullable field).
 *
 * Throws `PostUpdateConflictError` when the condition failed (the post
 * changed or is gone — nothing written) and
 * `ConditionalPostUpdateUnsupportedError` when the deployed backend has no
 * such mutation (not upgraded — nothing executed). Never falls back to the
 * stock unconditional `updatePost`. Other errors are rethrown unchanged.
 */
export async function updatePostIfUnchanged(
  client: GraphqlClient,
  postId: string,
  patch: Record<string, unknown>,
  expected: Record<string, unknown>,
): Promise<VersionedPost> {
  const expectedUpdatedAt = typeof expected.updatedAt === 'string' ? expected.updatedAt : ''
  let data: { amplessUpdatePostIfUnchanged: Parameters<typeof toCorePost>[0] | null }
  try {
    data = await client.query(MUTATION, {
      postId,
      patch: JSON.stringify(patch),
      expected: JSON.stringify(expected),
    })
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new PostUpdateConflictError(postId, expectedUpdatedAt, { cause: err })
    if (isConditionalMutationMissing(err)) {
      console.error('[mcp] backend lacks amplessUpdatePostIfUnchanged', err)
      throw new ConditionalPostUpdateUnsupportedError(MISSING_MUTATION_MESSAGE)
    }
    throw err
  }
  if (!data.amplessUpdatePostIfUnchanged) {
    throw new Error(`amplessUpdatePostIfUnchanged returned no post for ${postId}`)
  }
  return withVersion(toCorePost(data.amplessUpdatePostIfUnchanged))
}
