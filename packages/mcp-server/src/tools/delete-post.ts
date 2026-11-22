import { bundlePrefix, isReservedStaticSlug, versionedBundlesPrefix } from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { getPost } from './get-post.js'
import { removeStaticPrefix } from './static-bundle-storage.js'

const MUTATION = /* GraphQL */ `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      postId
    }
  }
`

export interface DeletePostArgs {
  postId: string
}

export const deletePostSchema = {
  type: 'object',
  required: ['postId'],
  properties: {
    postId: { type: 'string' },
  },
} as const

/**
 * Delete a post. For a `format: 'static'` post, its bundle files are
 * removed afterwards — the legacy per-slug prefix and every versioned
 * bundle of the slug (`public/static/_v/<slug>/`) — when `storage` is
 * given. That cleanup runs after the row is gone (so a live post never
 * loses its files) and is best-effort: a failure is logged and leaves
 * orphans, never failing the delete.
 */
export async function deletePost(
  client: GraphqlClient,
  args: DeletePostArgs,
  storage?: () => StorageClient,
): Promise<{ deleted: { postId: string } }> {
  const existing = storage ? await getPost(client, { postId: args.postId }) : null

  const data = await client.query<{
    deletePost: { postId: string }
  }>(MUTATION, { input: { postId: args.postId } })

  if (storage && existing && existing.format === 'static') {
    const slug = existing.slug
    const prefixes = [
      ...(isReservedStaticSlug(slug) ? [] : [bundlePrefix(slug)]),
      versionedBundlesPrefix(slug),
    ]
    for (const prefix of prefixes) {
      try {
        await removeStaticPrefix(storage(), prefix)
      } catch (err) {
        console.error(`[delete_post] failed to remove static bundle files under ${prefix}`, err)
      }
    }
  }

  // PostTag denormalized index is dropped by the trusted-processor
  // Lambda from the Post DynamoDB stream (REMOVE event carries the
  // old image, which the processor uses to derive the entries to
  // delete).
  return { deleted: data.deletePost }
}
