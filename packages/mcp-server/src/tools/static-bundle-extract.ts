/**
 * Server-side zip extractor used by the static-bundle MCP tools. Both
 * the stdio CLI and the Lambda HTTP transport run this — `fflate` is
 * a workspace dependency of `@ampless/mcp-server`, so the import
 * resolves identically in both. The browser-side admin uploader has
 * its own `extractZip(File)` based on JSZip (works on a `File`, not a
 * `Buffer`).
 *
 * Behaviour parity with the admin extractor:
 *  - Skip directory entries (fflate gives byte arrays only, so this
 *    is naturally satisfied unless the zip has empty-byte directory
 *    placeholders — those still get filtered out by validateBundlePath
 *    returning "directory entry" for any path ending with `/`).
 *  - Silently drop OS-specific junk (`__MACOSX/*`, `.DS_Store`,
 *    `Thumbs.db`) so callers don't see them as bundle entries.
 *  - Surface structural issues (absolute paths, parent traversal, null
 *    bytes) so the tool can reject the upload.
 *  - Strip a common single top-level directory (macOS Finder zips
 *    wrap their contents in a folder).
 */

import { unzipSync, strFromU8 } from 'fflate'
import {
  validateBundlePath,
  stripCommonPrefix,
  type BundleExtractResult,
  type ExtractedFile,
  type ValidationIssue,
} from 'ampless'

export interface ExtractZipOptions {
  /**
   * Hard ceiling on uncompressed bundle bytes. Defaults to 50 MB,
   * matching the browser uploader's MAX_BUNDLE_BYTES. Callers running
   * inside a tight Lambda envelope (Function URL payload cap ~6 MB
   * post-base64) can tighten this; setting it lower than the bundle
   * causes `extractZipFromBuffer` to throw before fully populating
   * `files`.
   */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

/**
 * Unzip `buffer` in memory and return the same shape the browser
 * `extractZip(File)` helper returns. Throws if the unzip itself fails
 * (corrupt archive) or if the uncompressed size exceeds `maxBytes`.
 */
export function extractZipFromBuffer(
  buffer: Uint8Array,
  opts: ExtractZipOptions = {},
): BundleExtractResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  const entries = unzipSync(buffer)
  const files: ExtractedFile[] = []
  const issues: ValidationIssue[] = []
  let totalBytes = 0

  for (const [name, data] of Object.entries(entries)) {
    // fflate yields empty byte arrays for explicit directory entries
    // in some zip producers — validateBundlePath catches the trailing-
    // slash form ("directory entry"), but skip zero-byte entries with
    // a trailing slash just in case the path was already normalised.
    if (name.endsWith('/')) continue

    const reason = validateBundlePath(name)
    if (reason) {
      const silent =
        reason === 'macOS resource fork' ||
        reason === '.DS_Store junk' ||
        reason === 'Thumbs.db junk' ||
        reason === 'directory entry'
      if (!silent) issues.push({ path: name, reason })
      continue
    }

    totalBytes += data.byteLength
    if (totalBytes > maxBytes) {
      throw new Error(
        `Bundle too large: uncompressed size exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB ceiling.`,
      )
    }
    files.push({ path: name, data })
  }

  return { files: stripCommonPrefix(files), issues, totalBytes }
}

/**
 * Decode an extracted file's bytes as UTF-8 text. Used by the tool
 * handler before running cross-file `validateBundle` so we don't
 * instantiate a TextDecoder per entry. fflate provides a fast helper.
 */
export function decodeUtf8(data: Uint8Array): string {
  return strFromU8(data)
}
