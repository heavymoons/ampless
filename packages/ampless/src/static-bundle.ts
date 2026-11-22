/**
 * Pure helpers for `format: 'static'` post bundles. Kept platform-free
 * (no `File`, no Amplify Storage, no AWS SDK) so both the browser admin
 * uploader and the MCP tools (running in stdio CLI + Lambda HTTP
 * transport) can share the validation / picker / mime logic.
 *
 * The `extractZip(File)` / `uploadBundle` / `deleteBundle` browser
 * helpers stay in `@ampless/admin/lib/static-bundle.js` — they pull in
 * JSZip and `aws-amplify/storage`, neither of which we want in Lambda.
 * The MCP Lambda implements its own zip extractor (`fflate`) on top of
 * the helpers here.
 */

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

export const DEFAULT_ENTRYPOINT = 'index.html'

/**
 * Maximum bundle size (uncompressed) for the browser-side admin
 * pipeline. Above this the in-tab extract / multi-PUT pipeline gets
 * sluggish. The Lambda / MCP side enforces its own limit (Function URL
 * payload cap, around 6 MB base64-inflated per call) — this constant
 * is exported as a reasonable upper bound for any caller that wants
 * a sanity check, not a hard contract for non-browser paths.
 */
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024 // 50 MB

// Extensions for which we run the "absolute path" lint. JS / map / json
// are skipped — paths inside them are too dynamic to validate reliably,
// and we already require relative-only as a contract.
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.html',
  '.htm',
  '.css',
  '.svg',
])

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
// Extracted-bundle types
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

// ----------------------------------------------------------------------------
// Cross-file reference validation
// ----------------------------------------------------------------------------

/**
 * Scan every text file in the bundle for absolute URL refs. Returns
 * the union of issues across files so the admin UI / MCP tool can
 * render a single list of problems before saving.
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
// S3 key helpers
// ----------------------------------------------------------------------------

export function bundlePrefix(slug: string): string {
  return `public/static/${slug}/`
}

// ----------------------------------------------------------------------------
// Common-prefix stripping (macOS Finder zips wrap contents in a folder)
// ----------------------------------------------------------------------------

/**
 * If every file shares the same top-level directory (e.g. macOS Finder
 * zipping wraps the contents in a `MyBundle/` folder), strip that
 * prefix so the bundle's logical root is the entrypoint's parent.
 * Bundles already at root pass through unchanged.
 */
export function stripCommonPrefix(files: ExtractedFile[]): ExtractedFile[] {
  if (files.length === 0) return files
  const firstSlash = files[0]!.path.indexOf('/')
  if (firstSlash < 0) return files
  const prefix = files[0]!.path.slice(0, firstSlash + 1)
  if (!files.every((f) => f.path.startsWith(prefix))) return files
  return files.map((f) => ({ ...f, path: f.path.slice(prefix.length) }))
}

// ----------------------------------------------------------------------------
// Entrypoint picker
// ----------------------------------------------------------------------------

/**
 * Heuristic for the default entrypoint when the caller didn't override:
 *   1. exact `index.html` at root
 *   2. exact `index.htm` at root
 *   3. the first .html / .htm file at root (alphabetical)
 *   4. the first .html / .htm anywhere
 *   5. fall back to the literal 'index.html' so the validator surfaces
 *      a meaningful error to the user ("entrypoint not in bundle")
 *
 * Accepts either extracted files (with `data`) or a plain list of
 * relative paths — the MCP `commit_static_post` flow only has the
 * S3 ListObjects result to work with, no bytes.
 */
export function pickDefaultEntrypoint(
  files: readonly { path: string }[],
): string {
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
