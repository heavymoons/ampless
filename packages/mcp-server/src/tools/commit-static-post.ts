import {
  bundlePrefix,
  pickDefaultEntrypoint,
  type PostMetadata,
  type StaticPostBody,
} from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { upsertStaticPost } from './upsert-static-post.js'

export interface CommitStaticPostArgs {
  siteId?: string
  slug: string
  title?: string
  entrypoint?: string
  postId?: string
  status?: 'draft' | 'published'
  publishedAt?: string
  excerpt?: string
  tags?: string[]
  metadata?: PostMetadata | Record<string, unknown>
}

export const commitStaticPostSchema = {
  type: 'object',
  required: ['slug'],
  properties: {
    slug: { type: 'string' },
    title: {
      type: 'string',
      description:
        'Required when this is a brand-new post (no existing row at the slug). On update, falls back to the current title.',
    },
    entrypoint: {
      type: 'string',
      description:
        'Relative path of the entry file (defaults to `index.html`, or the first `.html` at root if absent). Must exist under the current S3 prefix.',
    },
    postId: {
      type: 'string',
      description:
        'Optional explicit Post id when creating a new post. Ignored if a row at this slug already exists.',
    },
    status: { type: 'string', enum: ['draft', 'published'] },
    publishedAt: { type: 'string', description: 'ISO 8601 timestamp.' },
    excerpt: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: {
      type: 'object',
      description: 'Free-form per-post metadata. Passing this REPLACES the existing object on update.',
      additionalProperties: true,
    },
  },
} as const

/**
 * Rebuild a static post's Post row to match whatever is currently in
 * its S3 prefix. Intended as the "save" step after a series of
 * `upload_static_file` / `delete_static_file` calls — those tools edit
 * S3 in place but don't touch the DB manifest, so the Post's `body`
 * gradually drifts out of sync with the actual asset list. Calling
 * `commit_static_post` re-scans the prefix and writes the new manifest
 * (entrypoint + sorted file list + fresh uploadedAt timestamp).
 *
 * Also doubles as a "create an empty static post" entry point if the
 * caller has already uploaded the files via `upload_static_file`
 * without ever calling `upload_static_bundle`.
 */
export async function commitStaticPost(
  graphql: GraphqlClient,
  storage: StorageClient,
  defaultSiteId: string,
  args: CommitStaticPostArgs,
) {
  const siteId = args.siteId ?? defaultSiteId
  const slug = args.slug
  const prefix = bundlePrefix(siteId, slug)

  const objects = await storage.listObjects(prefix)
  if (objects.length === 0) {
    throw new Error(
      `commit_static_post: no files found under "${prefix}". Upload at least one file via upload_static_file or upload_static_bundle before committing.`,
    )
  }

  // Strip the prefix so the manifest stores bundle-relative paths
  // (matches what extractZipFromBuffer / uploadBundle write).
  const relPaths = objects
    .map((o) => o.key.slice(prefix.length))
    .filter((p) => p !== '')
    .sort()

  const entrypoint =
    args.entrypoint ?? pickDefaultEntrypoint(relPaths.map((p) => ({ path: p })))
  if (!relPaths.includes(entrypoint)) {
    throw new Error(
      `commit_static_post: entrypoint "${entrypoint}" is not present under "${prefix}".`,
    )
  }

  const body: StaticPostBody = {
    entrypoint,
    files: relPaths,
    uploadedAt: new Date().toISOString(),
  }

  const { post, created } = await upsertStaticPost(graphql, siteId, slug, body, {
    title: args.title,
    postId: args.postId,
    excerpt: args.excerpt,
    status: args.status,
    publishedAt: args.publishedAt,
    tags: args.tags,
    metadata: args.metadata,
  })

  return { post, bundle: body, created }
}
