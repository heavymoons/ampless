import { staticBundleVersion, type Post } from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { getPost } from './get-post.js'

/** Delete every object under `prefix`. */
export async function removeStaticPrefix(storage: StorageClient, prefix: string): Promise<void> {
  const objects = await storage.listObjects(prefix)
  for (const obj of objects) {
    await storage.deleteObject(obj.key)
  }
}

/**
 * Best-effort variant for cleanup of a prefix no stored post references
 * (a just-uploaded version whose write failed, a replaced version). A
 * failure only leaves an orphan, so it is logged and swallowed.
 */
export async function removeStaticPrefixBestEffort(
  storage: StorageClient,
  prefix: string,
  tool: string,
): Promise<void> {
  try {
    await removeStaticPrefix(storage, prefix)
  } catch (err) {
    console.error(`[${tool}] failed to remove unreferenced static bundle prefix ${prefix}`, err)
  }
}

/**
 * The per-file tools edit the legacy per-slug prefix in place. A post
 * whose current body is versioned is served from its immutable version
 * prefix instead, so editing the legacy prefix would silently do nothing
 * (and `commit_static_post` would swap the post back to stale legacy
 * files): fail closed. Legacy posts, non-static posts and slugs without a
 * post pass. Returns the post read (or `null`).
 */
export async function assertLegacyStaticSlug(
  graphql: GraphqlClient,
  slug: string,
  tool: string,
): Promise<Post | null> {
  const post = await getPost(graphql, { slug })
  if (post && post.format === 'static' && staticBundleVersion(post.body)) {
    throw new Error(
      `${tool}: the static post at slug "${slug}" uses a versioned bundle (version ${staticBundleVersion(post.body)}), which per-file tools cannot edit. Use upload_static_bundle with the complete zip to replace a versioned bundle.`,
    )
  }
  return post
}
