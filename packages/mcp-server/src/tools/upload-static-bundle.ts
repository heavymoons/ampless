import {
  generateBundleVersion,
  staticBundleVersion,
  versionedBundlePrefix,
  mimeTypeFor,
  pickDefaultEntrypoint,
  validateBundle,
  type PostMetadata,
  type StaticPostBody,
  type StaticPostFileMeta,
} from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { extractZipFromBuffer } from './static-bundle-extract.js'
import { upsertStaticPost, StaticPostConflictError } from './upsert-static-post.js'
import { getPost } from './get-post.js'
import { removeStaticPrefixBestEffort } from './static-bundle-storage.js'

export interface UploadStaticBundleArgs {
  postId?: string
  slug: string
  title: string
  /** Base64-encoded zip archive contents. NO `data:` URL prefix. */
  zipBase64: string
  /** Relative path inside the bundle to serve as the entry. Defaults to `index.html` (or another heuristic pick). */
  entrypoint?: string
  status?: 'draft' | 'published'
  excerpt?: string
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata | Record<string, unknown>
}

export const uploadStaticBundleSchema = {
  type: 'object',
  required: ['slug', 'title', 'zipBase64'],
  properties: {
    postId: {
      type: 'string',
      description:
        'Optional explicit Post id when creating a new post. Ignored if a post at this slug already exists.',
    },
    slug: { type: 'string', description: 'URL slug. Doubles as the S3 bundle path key.' },
    title: { type: 'string' },
    zipBase64: {
      type: 'string',
      description:
        'Base64-encoded zip archive. NO `data:` URL prefix. Every entry must reference others by RELATIVE path; absolute paths (`/foo`) and protocol-relative URLs (`//cdn/foo`) inside HTML / CSS / SVG are rejected as the bundle would not be portable across URL prefixes.',
    },
    entrypoint: {
      type: 'string',
      description:
        'Relative path to the file served at the post URL (default `index.html`, or the first `.html` at root if `index.html` is absent).',
    },
    status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
    excerpt: { type: 'string' },
    publishedAt: { type: 'string', description: 'ISO 8601 timestamp; defaults to "now" when status=published.' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: {
      type: 'object',
      description:
        'Free-form per-post metadata. NOTE: `no_layout` is irrelevant for static posts (the bundle is already served raw).',
      additionalProperties: true,
    },
  },
} as const

/**
 * Replace a static post's bundle with the zip the caller submitted, then
 * upsert the matching Post row (`format: 'static'`, `body` = manifest
 * pointing at the entrypoint, listing every uploaded file, and carrying
 * the new immutable `version`).
 *
 * The files go to a NEW version prefix
 * `public/static/_v/<encoded slug>/<version>/`; nothing the current post
 * references is deleted or overwritten before the post write commits, so
 * a refused or failed write leaves the live bundle intact.
 *
 * Workflow:
 *   1. base64-decode the archive bytes.
 *   2. unzip in memory and validate every entry path (no `..`,
 *      no absolute paths, no null bytes).
 *   3. lint every text file (HTML / CSS / SVG) for absolute path
 *      references — bundles are required to be self-contained via
 *      relative paths. Issues are surfaced as a thrown error.
 *   4. read the current post at the slug.
 *   5. PutObject every file into the new version prefix with the
 *      correct Content-Type.
 *   6. upsert the Post row: create, or update conditionally on the
 *      `updatedAt` read in step 4. On any write failure (a conflict
 *      included) the new version is removed again and the error is
 *      re-thrown; a conflict says to retry.
 *   7. after a successful update, garbage-collect the previous bundle if
 *      it was versioned. A previous legacy prefix
 *      (`public/static/<slug>/`) is left in place: per-file tools may
 *      still be working on it.
 */
export async function uploadStaticBundle(
  graphql: GraphqlClient,
  storage: StorageClient,
  args: UploadStaticBundleArgs,
) {
  const slug = args.slug

  // 1. Decode the archive.
  const zipBytes = Buffer.from(args.zipBase64, 'base64')
  if (zipBytes.length === 0) {
    throw new Error('upload_static_bundle: zipBase64 decoded to zero bytes.')
  }

  // 2. Extract + path-validate.
  const { files, issues } = extractZipFromBuffer(zipBytes)
  if (issues.length > 0) {
    throw new Error(
      `upload_static_bundle: rejected bundle path(s): ${issues
        .map((i) => `${i.path} (${i.reason})`)
        .join('; ')}`,
    )
  }
  if (files.length === 0) {
    throw new Error('upload_static_bundle: zip contained no files.')
  }

  // 3. Cross-file content lint.
  const contentIssues = validateBundle(files)
  if (contentIssues.length > 0) {
    throw new Error(
      `upload_static_bundle: bundle contains absolute / protocol-relative refs: ${contentIssues
        .map((i) => `${i.path}: ${i.reason}`)
        .join('; ')}`,
    )
  }

  // Resolve the entrypoint and confirm it exists.
  const entrypoint = args.entrypoint ?? pickDefaultEntrypoint(files)
  if (!files.some((f) => f.path === entrypoint)) {
    throw new Error(
      `upload_static_bundle: entrypoint "${entrypoint}" is not present in the bundle.`,
    )
  }

  // 4. The row the write below must replace (compare-and-swap).
  const existing = await getPost(graphql, { slug })

  // 5. Upload every file with the correct MIME into a fresh version
  //    prefix. Track per-file size + mimeType so the Post row's
  //    metadata.files map lets the static route skip a HEAD round-trip
  //    on first read. A failed upload removes what it already wrote.
  const version = generateBundleVersion()
  const prefix = versionedBundlePrefix(slug, version)
  let uploadedFiles = 0
  const filesMeta: Record<string, StaticPostFileMeta> = {}
  try {
    for (const f of files) {
      const mimeType = mimeTypeFor(f.path)
      await storage.putObject(`${prefix}${f.path}`, f.data, mimeType)
      filesMeta[f.path] = { size: f.data.byteLength, mimeType }
      uploadedFiles += 1
    }
  } catch (err) {
    console.error('[upload_static_bundle] upload failed; removing the partial version', err)
    await removeStaticPrefixBestEffort(storage, prefix, 'upload_static_bundle')
    throw err
  }

  // 6. Build the manifest and upsert the Post row. The per-file size /
  //    mimeType map lands in `metadata.files` (alongside any caller-
  //    supplied metadata keys) so the static delivery route can stream
  //    back small files without a HEAD.
  const body: StaticPostBody = {
    entrypoint,
    files: files.map((f) => f.path).sort(),
    uploadedAt: new Date().toISOString(),
    version,
  }
  const mergedMetadata: PostMetadata | Record<string, unknown> = {
    ...(args.metadata ?? {}),
    files: filesMeta,
  }
  let result: Awaited<ReturnType<typeof upsertStaticPost>>
  try {
    result = await upsertStaticPost(
      graphql,
      slug,
      body,
      {
        title: args.title,
        postId: args.postId,
        status: args.status,
        publishedAt: args.publishedAt,
        excerpt: args.excerpt,
        tags: args.tags,
        metadata: mergedMetadata,
      },
      { existing },
    )
  } catch (err) {
    // Nothing references the new version: remove it. The live bundle was
    // never touched.
    await removeStaticPrefixBestEffort(storage, prefix, 'upload_static_bundle')
    if (err instanceof StaticPostConflictError) {
      throw new Error(
        `upload_static_bundle: ${err.message} The live bundle is unchanged and the uploaded files were removed. Re-read the post (get_post) and retry.`,
      )
    }
    throw err
  }

  // 7. The write replaced exactly `previous`; its versioned bundle is
  //    unreferenced now (nothing else writes into a version prefix).
  const previous = result.previous
  const previousVersion =
    previous && previous.format === 'static' ? staticBundleVersion(previous.body) : undefined
  if (previous && previousVersion) {
    await removeStaticPrefixBestEffort(
      storage,
      versionedBundlePrefix(previous.slug, previousVersion),
      'upload_static_bundle',
    )
  } else if (previous && previous.format === 'static') {
    console.info(
      `[upload_static_bundle] "${slug}" now uses a versioned bundle; its legacy files under public/static/${slug}/ are left in place.`,
    )
  }

  return { post: result.post, bundle: body, uploadedFiles }
}
