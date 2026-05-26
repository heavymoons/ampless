import JSZip from 'jszip'
import { uploadData, list, remove } from 'aws-amplify/storage'
import {
  type StaticPostBody,
  type StaticPostFileMeta,
  type ExtractedFile,
  type ValidationIssue,
  type BundleExtractResult,
  mimeTypeFor,
  validateBundlePath,
  findAbsolutePathRefs,
  validateBundle,
  bundlePrefix,
  pickDefaultEntrypoint,
  stripCommonPrefix,
  MAX_BUNDLE_BYTES,
} from 'ampless'

// Re-export the pure helpers + types so existing consumers
// (`./static-bundle.js`) keep their import path. The browser-specific
// pieces (`extractZip`, `uploadBundle`, `deleteBundle`) live below.
export {
  mimeTypeFor,
  validateBundlePath,
  findAbsolutePathRefs,
  validateBundle,
  bundlePrefix,
}
export type { ExtractedFile, ValidationIssue, BundleExtractResult }

// ----------------------------------------------------------------------------
// Zip extraction (browser-only — depends on JSZip + the File API)
// ----------------------------------------------------------------------------

/**
 * Pull a zip's contents into memory and validate every entry. Skips
 * directory entries, rejects suspicious paths up front. Caller is
 * responsible for handling `issues` (warn / block save).
 *
 * Files in the bundle keep their original relative paths. A zip with
 * a single top-level wrapper directory (e.g. `mybundle/index.html`)
 * has that wrapper stripped so the entrypoint stays at the bundle
 * root — common when zipping a folder on macOS.
 */
export async function extractZip(file: File): Promise<BundleExtractResult> {
  const zip = await JSZip.loadAsync(file)
  const files: ExtractedFile[] = []
  const issues: ValidationIssue[] = []
  let totalBytes = 0

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const reason = validateBundlePath(entry.name)
    if (reason) {
      // Junk we can silently drop; structural issues we surface.
      const silent =
        reason === 'macOS resource fork' ||
        reason === '.DS_Store junk' ||
        reason === 'Thumbs.db junk'
      if (!silent) issues.push({ path: entry.name, reason })
      continue
    }
    const data = await entry.async('uint8array')
    totalBytes += data.byteLength
    files.push({ path: entry.name, data })
  }

  return { files: stripCommonPrefix(files), issues, totalBytes }
}

// ----------------------------------------------------------------------------
// S3 upload / delete (browser-side via Amplify Storage)
// ----------------------------------------------------------------------------

export interface UploadOptions {
  slug: string
  files: ExtractedFile[]
  /** Set to a non-default file if the user wants something other than `index.html` to be the entry. */
  entrypoint?: string
  onProgress?: (uploaded: number, total: number) => void
}

export interface UploadBundleResult {
  /** The Post `body` manifest (entrypoint + sorted file list + timestamp). */
  body: StaticPostBody
  /**
   * Per-file size / mimeType map. Lands in `post.metadata.files` so
   * the static delivery route can stream small files back through
   * Lambda without a HEAD round-trip.
   */
  filesMeta: Record<string, StaticPostFileMeta>
}

/**
 * Wipe the existing prefix, then upload every file. Order matters —
 * doing the prefix clear first means a re-upload always replaces
 * (not merges) the bundle, so removed files don't linger in S3.
 *
 * Returns both the manifest (for `post.body`) and a per-file size /
 * mimeType map (for `post.metadata.files`). Callers wire the latter
 * into the metadata blob alongside the existing `no_layout` / `cache`
 * keys.
 */
export async function uploadBundle(opts: UploadOptions): Promise<UploadBundleResult> {
  if (opts.files.length === 0) {
    throw new Error('Bundle is empty.')
  }
  const totalBytes = opts.files.reduce((sum, f) => sum + f.data.byteLength, 0)
  if (totalBytes > MAX_BUNDLE_BYTES) {
    throw new Error(
      `Bundle too large: ${Math.round(totalBytes / 1024 / 1024)} MB exceeds the ${Math.round(MAX_BUNDLE_BYTES / 1024 / 1024)} MB ceiling for browser-side upload.`,
    )
  }

  const entrypoint = opts.entrypoint ?? pickDefaultEntrypoint(opts.files)
  if (!opts.files.some((f) => f.path === entrypoint)) {
    throw new Error(`Entrypoint "${entrypoint}" is not present in the bundle.`)
  }

  // Clear the existing prefix so removed files vanish. Best-effort — if
  // the listing fails (no prior bundle), proceed with the upload anyway.
  await deleteBundle(opts.slug).catch(() => undefined)

  const prefix = bundlePrefix(opts.slug)
  let uploaded = 0
  const filesMeta: Record<string, StaticPostFileMeta> = {}
  for (const f of opts.files) {
    const mimeType = mimeTypeFor(f.path)
    const task = uploadData({
      path: `${prefix}${f.path}`,
      data: f.data,
      // Forcing Content-Type at upload means CloudFront / browsers see
      // it directly when serving the file via the public bucket URL.
      // (The runtime route handler overrides it for the proxied path,
      // but tooling that hits S3 directly benefits from a correct CT.)
      options: { contentType: mimeType },
    })
    await task.result
    filesMeta[f.path] = { size: f.data.byteLength, mimeType }
    uploaded += f.data.byteLength
    opts.onProgress?.(uploaded, totalBytes)
  }

  return {
    body: {
      entrypoint,
      files: opts.files.map((f) => f.path).sort(),
      uploadedAt: new Date().toISOString(),
    },
    filesMeta,
  }
}

/**
 * Recursively delete everything under the bundle's S3 prefix. Used
 * when a static post is deleted or just before a fresh upload.
 */
export async function deleteBundle(slug: string): Promise<void> {
  const prefix = bundlePrefix(slug)
  const result = await list({ path: prefix })
  for (const item of result.items) {
    await remove({ path: item.path })
  }
}
