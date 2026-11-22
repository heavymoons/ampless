import { bundlePrefix, validateBundlePath } from 'ampless'
import type { StorageClient } from './types.js'

export interface DeleteStaticFileArgs {
  slug: string
  filename: string
}

export const deleteStaticFileSchema = {
  type: 'object',
  required: ['slug', 'filename'],
  properties: {
    slug: { type: 'string' },
    filename: {
      type: 'string',
      description:
        'Relative path inside the bundle to delete. Same path rules as `upload_static_file` apply (no `..`, no absolute paths, no null bytes).',
    },
  },
} as const

/**
 * Delete a single file inside a static bundle. The Post row is NOT
 * touched, so the in-DB manifest can drift from the S3 prefix until
 * the caller invokes `commit_static_post`. Use this for incremental
 * cleanup; the bundle-wide replace is `upload_static_bundle`.
 *
 * Returns `{ deleted: false }` without throwing when the object isn't
 * there — S3 DeleteObject is idempotent and the public-API ergonomics
 * are nicer if the caller can issue cleanups without first checking
 * existence.
 */
export async function deleteStaticFile(
  storage: StorageClient,
  args: DeleteStaticFileArgs,
) {
  const reason = validateBundlePath(args.filename)
  if (reason) {
    throw new Error(`delete_static_file: invalid filename "${args.filename}" (${reason})`)
  }

  const prefix = bundlePrefix(args.slug)
  const key = `${prefix}${args.filename}`

  // Probe existence so we can report `deleted: true / false` instead
  // of always claiming success. ListObjects with a one-key prefix is
  // the cheapest way to test without a HeadObject permission grant.
  const existing = await storage.listObjects(key)
  const found = existing.some((o) => o.key === key)
  if (!found) {
    return { key, deleted: false as const }
  }

  await storage.deleteObject(key)
  return { key, deleted: true as const }
}
