import JSZip from 'jszip'
import { uploadData, list, remove } from 'aws-amplify/storage'
import type { StaticPostBody } from 'ampless'

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DEFAULT_ENTRYPOINT = 'index.html'

/**
 * Maximum bundle size (uncompressed). Above this, the browser-side
 * extract/upload pipeline gets sluggish and S3 multi-PUTs start eating
 * a lot of memory. If a project actually needs bigger bundles, switch
 * to a Lambda-side extraction pipeline instead.
 */
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024 // 50 MB

// Extensions for which we run the "absolute path" lint. JS / map / json
// are skipped — paths inside them are too dynamic to validate reliably,
// and we already require relative-only as a contract.
const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.svg'])

/**
 * MIME types served for each extension. Browsers usually sniff from the
 * file bytes anyway, but explicit Content-Type is required for HTML
 * (forced as text/html so the body isn't downloaded as text/plain) and
 * for JS modules served via `<script type="module" src="…">`.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
}

export function mimeTypeFor(path: string): string {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_TYPES[lower.slice(dot)] ?? 'application/octet-stream'
}

// ----------------------------------------------------------------------------
// Path validation
// ----------------------------------------------------------------------------

export interface ValidationIssue {
  path: string
  line?: number
  reason: string
}

/**
 * Reject paths that would either escape the bundle root (`..`), confuse
 * S3 (`null bytes`), or carry OS-specific cruft from zip tools
 * (`__MACOSX/`, `.DS_Store`). Returns `null` when the path is OK,
 * otherwise the reason to surface to the user.
 */
export function validateBundlePath(path: string): string | null {
  if (path === '' || path.endsWith('/')) return 'directory entry'
  if (path.includes('\0')) return 'contains null byte'
  if (path.startsWith('/') || path.startsWith('\\')) return 'absolute path'
  if (path.split(/[/\\]/).some((seg) => seg === '..')) return 'parent-directory traversal'
  if (path.startsWith('__MACOSX/') || /(^|\/)\._/.test(path)) return 'macOS resource fork'
  if (/(^|\/)\.DS_Store$/.test(path)) return '.DS_Store junk'
  if (/(^|\/)Thumbs\.db$/i.test(path)) return 'Thumbs.db junk'
  return null
}

// HTML attributes commonly carrying URL refs. We don't try to be
// exhaustive — these cover the patterns hand-written / build-tool-emitted
// bundles realistically produce. JS files are intentionally not scanned
// (too many false positives from string concat / template literals).
const HTML_URL_ATTR_RE = /\b(?:href|src|action|data|poster|cite|formaction|manifest|srcset)\s*=\s*["']([^"']+)["']/gi
const CSS_URL_RE = /url\(\s*["']?([^"')\s]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi

/**
 * Scan text files for **absolute** path references. The static-bundle
 * contract is that every reference resolves inside the bundle via
 * relative paths, so any `href="/foo"` would either escape to the
 * Next.js root or break under arbitrary URL prefixes. Protocol-prefixed
 * URLs (`https://…`) and `mailto:` / `tel:` are fine.
 *
 * `data:` and `blob:` URIs also pass (they don't traverse the network).
 * Hash-only (`#anchor`) and empty values pass too.
 */
export function findAbsolutePathRefs(
  path: string,
  content: string,
): ValidationIssue[] {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.'))
  if (!TEXT_EXTENSIONS.has(ext)) return []

  const issues: ValidationIssue[] = []

  function check(url: string, lineHint: string): void {
    const trimmed = url.trim()
    if (!trimmed) return
    if (trimmed.startsWith('#')) return
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return // protocol scheme (https, mailto, data, etc.)
    if (trimmed.startsWith('//')) {
      issues.push({ path, reason: `protocol-relative URL: ${lineHint}` })
      return
    }
    if (trimmed.startsWith('/')) {
      issues.push({ path, reason: `absolute path: ${lineHint}` })
      return
    }
  }

  if (ext === '.html' || ext === '.htm' || ext === '.svg') {
    HTML_URL_ATTR_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = HTML_URL_ATTR_RE.exec(content)) !== null) {
      const val = m[1] ?? ''
      // srcset is comma-separated; check each candidate URL
      if (/\bsrcset\s*=/i.test(m[0])) {
        for (const candidate of val.split(',')) {
          const urlPart = candidate.trim().split(/\s+/)[0]
          if (urlPart) check(urlPart, candidate.trim())
        }
      } else {
        check(val, m[0])
      }
    }
  }

  if (ext === '.css' || ext === '.svg') {
    CSS_URL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CSS_URL_RE.exec(content)) !== null) {
      const val = (m[1] ?? m[2] ?? '').trim()
      check(val, m[0])
    }
  }

  return issues
}

// ----------------------------------------------------------------------------
// Zip extraction
// ----------------------------------------------------------------------------

export interface ExtractedFile {
  /** Relative path inside the bundle (slash-separated). */
  path: string
  data: Uint8Array
}

export interface BundleExtractResult {
  files: ExtractedFile[]
  issues: ValidationIssue[]
  totalBytes: number
}

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

/**
 * If every file shares the same top-level directory (e.g. macOS Finder
 * zipping wraps the contents in a `MyBundle/` folder), strip that
 * prefix so the bundle's logical root is the entrypoint's parent.
 * Bundles already at root pass through unchanged.
 */
function stripCommonPrefix(files: ExtractedFile[]): ExtractedFile[] {
  if (files.length === 0) return files
  const firstSlash = files[0]!.path.indexOf('/')
  if (firstSlash < 0) return files
  const prefix = files[0]!.path.slice(0, firstSlash + 1)
  if (!files.every((f) => f.path.startsWith(prefix))) return files
  return files.map((f) => ({ ...f, path: f.path.slice(prefix.length) }))
}

// ----------------------------------------------------------------------------
// Cross-file reference validation
// ----------------------------------------------------------------------------

/**
 * Scan every text file in the bundle for absolute URL refs. Returns
 * the union of issues across files so the admin UI can render a single
 * list of problems before saving.
 */
export function validateBundle(files: ExtractedFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const decoder = new TextDecoder('utf-8', { fatal: false })

  for (const f of files) {
    const ext = f.path.toLowerCase().slice(f.path.lastIndexOf('.'))
    if (!TEXT_EXTENSIONS.has(ext)) continue
    const text = decoder.decode(f.data)
    issues.push(...findAbsolutePathRefs(f.path, text))
  }
  return issues
}

// ----------------------------------------------------------------------------
// S3 upload / delete
// ----------------------------------------------------------------------------

export function bundlePrefix(siteId: string, slug: string): string {
  return `public/static/${siteId}/${slug}/`
}

export interface UploadOptions {
  siteId: string
  slug: string
  files: ExtractedFile[]
  /** Set to a non-default file if the user wants something other than `index.html` to be the entry. */
  entrypoint?: string
  onProgress?: (uploaded: number, total: number) => void
}

/**
 * Wipe the existing prefix, then upload every file. Order matters —
 * doing the prefix clear first means a re-upload always replaces
 * (not merges) the bundle, so removed files don't linger in S3.
 */
export async function uploadBundle(opts: UploadOptions): Promise<StaticPostBody> {
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
  await deleteBundle(opts.siteId, opts.slug).catch(() => undefined)

  const prefix = bundlePrefix(opts.siteId, opts.slug)
  let uploaded = 0
  for (const f of opts.files) {
    const task = uploadData({
      path: `${prefix}${f.path}`,
      data: f.data,
      // Forcing Content-Type at upload means CloudFront / browsers see
      // it directly when serving the file via the public bucket URL.
      // (The runtime route handler overrides it for the proxied path,
      // but tooling that hits S3 directly benefits from a correct CT.)
      options: { contentType: mimeTypeFor(f.path) },
    })
    await task.result
    uploaded += f.data.byteLength
    opts.onProgress?.(uploaded, totalBytes)
  }

  return {
    entrypoint,
    files: opts.files.map((f) => f.path).sort(),
    uploadedAt: new Date().toISOString(),
  }
}

/**
 * Recursively delete everything under the bundle's S3 prefix. Used
 * when a static post is deleted or just before a fresh upload.
 */
export async function deleteBundle(siteId: string, slug: string): Promise<void> {
  const prefix = bundlePrefix(siteId, slug)
  const result = await list({ path: prefix })
  for (const item of result.items) {
    await remove({ path: item.path })
  }
}

/**
 * Heuristic for the default entrypoint when the caller didn't override:
 *   1. exact `index.html` at root
 *   2. exact `index.htm` at root
 *   3. the first .html / .htm file at root (alphabetical)
 *   4. the first .html / .htm anywhere
 *   5. fall back to the literal 'index.html' so the validator surfaces
 *      a meaningful error to the user ("entrypoint not in bundle")
 */
function pickDefaultEntrypoint(files: ExtractedFile[]): string {
  const exact = files.find((f) => f.path === DEFAULT_ENTRYPOINT)
  if (exact) return exact.path
  const altRoot = files.find((f) => f.path === 'index.htm')
  if (altRoot) return altRoot.path

  const htmlRoot = files
    .filter((f) => /^[^/]+\.html?$/.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  if (htmlRoot.length > 0) return htmlRoot[0]!.path

  const htmlAny = files
    .filter((f) => /\.html?$/.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  if (htmlAny.length > 0) return htmlAny[0]!.path

  return DEFAULT_ENTRYPOINT
}
