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
  generateBundleVersion,
  versionedBundlePrefix,
  versionedBundlesPrefix,
  pickDefaultEntrypoint,
  stripCommonPrefix,
  MAX_BUNDLE_BYTES,
} from 'ampless'

// Re-export the pure helpers + types so existing consumers
// (`./static-bundle.js`) keep their import path. The browser-specific
// pieces (`extractZip`, `uploadBundle`, `deleteBundle`,
// `deleteBundleVersion`, `deleteAllBundleVersions`) live below.
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
  /**
   * The Post `body` manifest (entrypoint + sorted file list + timestamp +
   * the new immutable `version`).
   */
  body: StaticPostBody & { version: string }
  /**
   * Per-file size / mimeType map. Lands in `post.metadata.files` so
   * the static delivery route can stream small files back through
   * Lambda without a HEAD round-trip.
   */
  filesMeta: Record<string, StaticPostFileMeta>
}

/**
 * Upload every file into a NEW immutable version prefix
 * `public/static/_v/<slug>/<version>/` and return the manifest pointing
 * at it. Nothing is deleted: the bundle the post currently references
 * (versioned or legacy) stays intact until the caller's post write
 * commits, so a refused or failed write never leaves the live post
 * pointing at altered files. The caller cleans up this version if its
 * write fails (`deleteBundleVersion`) and garbage-collects the previous
 * version after a successful one.
 *
 * If an individual upload fails, the files already uploaded to the new
 * version are removed (best-effort) before the error is re-thrown.
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

  const version = generateBundleVersion()
  const prefix = versionedBundlePrefix(opts.slug, version)
  let uploaded = 0
  const filesMeta: Record<string, StaticPostFileMeta> = {}
  try {
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
  } catch (err) {
    console.error('[ampless static-bundle] upload failed; removing the partial version:', err)
    await deleteBundleVersion(opts.slug, version).catch((cleanupErr) => {
      console.error(
        `[ampless static-bundle] failed to remove partial bundle version ${prefix}:`,
        cleanupErr,
      )
    })
    throw err
  }

  return {
    body: {
      entrypoint,
      files: opts.files.map((f) => f.path).sort(),
      uploadedAt: new Date().toISOString(),
      version,
    },
    filesMeta,
  }
}

// Delete every object under `prefix` (all pages).
async function removePrefix(prefix: string): Promise<void> {
  const result = await list({ path: prefix, options: { listAll: true } })
  for (const item of result.items) {
    await remove({ path: item.path })
  }
}

/**
 * Recursively delete everything under the bundle's legacy per-slug
 * prefix `public/static/<slug>/`. Used when a static post is deleted.
 * Throws for a slug reserved for the versioned area (see `bundlePrefix`),
 * so it can never reach versioned bundles.
 */
export async function deleteBundle(slug: string): Promise<void> {
  await removePrefix(bundlePrefix(slug))
}

/** Delete one immutable bundle version of `slug`. */
export async function deleteBundleVersion(slug: string, version: string): Promise<void> {
  await removePrefix(versionedBundlePrefix(slug, version))
}

/**
 * Delete every versioned bundle of `slug` (`public/static/_v/<slug>/`),
 * including orphans a failed cleanup left behind. Used when a static
 * post is deleted.
 */
export async function deleteAllBundleVersions(slug: string): Promise<void> {
  await removePrefix(versionedBundlesPrefix(slug))
}
