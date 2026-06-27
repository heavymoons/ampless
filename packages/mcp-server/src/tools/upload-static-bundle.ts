import {
  bundlePrefix,
  mimeTypeFor,
  pickDefaultEntrypoint,
  validateBundle,
  type PostMetadata,
  type StaticPostBody,
  type StaticPostFileMeta,
} from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { extractZipFromBuffer } from './static-bundle-extract.js'
import { upsertStaticPost } from './upsert-static-post.js'

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
 * Replace the entire bundle at `public/static/<slug>/` with the zip
 * the caller submitted, then upsert the matching Post row
 * (`format: 'static'`, `body` = manifest pointing at the entrypoint
 * and listing every uploaded file).
 *
 * Workflow:
 *   1. base64-decode the archive bytes.
 *   2. unzip in memory and validate every entry path (no `..`,
 *      no absolute paths, no null bytes).
 *   3. lint every text file (HTML / CSS / SVG) for absolute path
 *      references — bundles are required to be self-contained via
 *      relative paths. Issues are surfaced as a thrown error.
 *   4. wipe the existing S3 prefix so removed files don't linger.
 *   5. PutObject every file with the correct Content-Type.
 *   6. upsert the Post row (create-or-update by slug).
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

  // 4. Wipe the existing prefix so removed files vanish. A missing prior
  // bundle is not an error (ListObjects returns empty); a genuine listing
  // failure means stale files could survive the wipe, violating the
  // full-prefix-replace contract — surface it instead of proceeding with [].
  const prefix = bundlePrefix(slug)
  const existing = await storage.listObjects(prefix).catch((err) => {
    console.error('[upload_static_bundle] listObjects failed', err)
    throw new Error(
      `upload_static_bundle: failed to list existing bundle objects for full-prefix wipe: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  })
  for (const obj of existing) {
    await storage.deleteObject(obj.key)
  }

  // 5. Upload every file with the correct MIME. Track per-file
  //    size + mimeType so the Post row's metadata.files map lets the
  //    static route skip a HEAD round-trip on first read.
  let uploadedFiles = 0
  const filesMeta: Record<string, StaticPostFileMeta> = {}
  for (const f of files) {
    const mimeType = mimeTypeFor(f.path)
    await storage.putObject(`${prefix}${f.path}`, f.data, mimeType)
    filesMeta[f.path] = { size: f.data.byteLength, mimeType }
    uploadedFiles += 1
  }

  // 6. Build the manifest and upsert the Post row. The per-file size /
  //    mimeType map lands in `metadata.files` (alongside any caller-
  //    supplied metadata keys) so the static delivery route can stream
  //    back small files without a HEAD.
  const body: StaticPostBody = {
    entrypoint,
    files: files.map((f) => f.path).sort(),
    uploadedAt: new Date().toISOString(),
  }
  const mergedMetadata: PostMetadata | Record<string, unknown> = {
    ...(args.metadata ?? {}),
    files: filesMeta,
  }
  const { post } = await upsertStaticPost(graphql, slug, body, {
    title: args.title,
    postId: args.postId,
    status: args.status,
    publishedAt: args.publishedAt,
    excerpt: args.excerpt,
    tags: args.tags,
    metadata: mergedMetadata,
  })

  return { post, bundle: body, uploadedFiles }
}
