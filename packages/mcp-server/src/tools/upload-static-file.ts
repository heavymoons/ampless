import {
  bundlePrefix,
  findAbsolutePathRefs,
  mimeTypeFor,
  validateBundlePath,
  TEXT_EXTENSIONS,
} from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { assertLegacyStaticSlug } from './static-bundle-storage.js'

export interface UploadStaticFileArgs {
  slug: string
  /** Relative path inside the bundle (slash-separated). Must satisfy the same rules as zip entries. */
  filename: string
  /** Optional explicit Content-Type. When omitted, derived from the filename extension. */
  contentType?: string
  /** Base64-encoded file body. NO `data:` URL prefix. */
  base64Data: string
}

export const uploadStaticFileSchema = {
  type: 'object',
  required: ['slug', 'filename', 'base64Data'],
  properties: {
    slug: {
      type: 'string',
      description:
        'Bundle slug. Files land at the legacy prefix public/static/<slug>/<filename>. Refused when the post at this slug uses a versioned bundle (replace it with upload_static_bundle).',
    },
    filename: {
      type: 'string',
      description:
        'Relative path inside the bundle. Must NOT start with `/`, contain `..`, or include null bytes. macOS / Windows zip junk (`.DS_Store`, `__MACOSX/*`, `Thumbs.db`) is also rejected.',
    },
    contentType: {
      type: 'string',
      description:
        'IANA media type. Omit to derive from the filename extension (text/html, text/css, application/javascript, image/* …; falls back to application/octet-stream).',
    },
    base64Data: {
      type: 'string',
      description:
        'Base64-encoded file bytes. NO `data:` URL prefix. Text files (HTML/CSS/SVG) are linted for absolute / protocol-relative URL refs — failures throw.',
    },
  },
} as const

/**
 * Upload a single file into a static bundle's legacy per-slug prefix.
 * The Post row is NOT touched — callers should follow up with
 * `commit_static_post` to rebuild the manifest from the current S3
 * prefix once their per-file edits are done. Useful for incremental
 * tweaks (one CSS change, a single image swap) without re-uploading the
 * entire bundle. Fails closed when the post at the slug uses a versioned
 * (immutable) bundle.
 */
export async function uploadStaticFile(
  graphql: GraphqlClient,
  storage: StorageClient,
  args: UploadStaticFileArgs,
) {
  const filename = args.filename

  const reason = validateBundlePath(filename)
  if (reason) {
    throw new Error(`upload_static_file: invalid filename "${filename}" (${reason})`)
  }

  const body = Buffer.from(args.base64Data, 'base64')
  if (body.length === 0) {
    throw new Error('upload_static_file: base64Data decoded to zero bytes.')
  }

  // Lint text files for absolute / protocol-relative URL refs. Keeps
  // bundles portable across URL prefixes (same contract the zip flow
  // enforces). Binary files are skipped — findAbsolutePathRefs returns
  // empty when the extension isn't in TEXT_EXTENSIONS.
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = body.toString('utf8')
    const issues = findAbsolutePathRefs(filename, text)
    if (issues.length > 0) {
      throw new Error(
        `upload_static_file: ${filename} contains absolute / protocol-relative refs: ${issues
          .map((i) => i.reason)
          .join('; ')}`,
      )
    }
  }

  const prefix = bundlePrefix(args.slug)
  await assertLegacyStaticSlug(graphql, args.slug, 'upload_static_file')

  const contentType = args.contentType ?? mimeTypeFor(filename)
  const key = `${prefix}${filename}`
  const { url } = await storage.putObject(key, body, contentType)
  return { key, url, size: body.length, contentType }
}
