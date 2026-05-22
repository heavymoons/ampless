export type ContentFormat = 'tiptap' | 'markdown' | 'html' | 'static'

/**
 * Body shape for `format: 'static'` posts. The actual asset bytes
 * live under S3 at `public/static/<slug>/<files...>` — the body here
 * is the manifest describing which entrypoint to serve and which files
 * are part of the bundle.
 *
 * Stored as JSON in the `body` column (same encoding pattern as the
 * tiptap doc / html string / markdown string for the other formats).
 *
 * Hard constraint enforced at upload time: every asset must reference
 * other assets in the bundle by **relative path** only. Absolute paths
 * (`/foo`) and protocol-relative paths (`//cdn.example/foo`) inside
 * referenced HTML / CSS are rejected so a bundle stays portable across
 * any URL prefix without rewriting at serve time. See the admin's
 * StaticUploader for the validation logic.
 */
export interface StaticPostBody {
  /** Relative path to the entrypoint inside the bundle (default 'index.html'). */
  entrypoint: string
  /** Every file in the bundle (relative paths). Used for delete cleanup and admin display. */
  files: string[]
  /** ISO 8601 timestamp of the most recent upload. */
  uploadedAt: string
}

export type PostStatus = 'draft' | 'published'

/**
 * Free-form per-post metadata. The `metadata` JSON column carries
 * arbitrary key/value pairs; the runtime / themes / plugins each pick
 * the keys they care about. A handful of well-known keys are owned by
 * ampless itself and documented here.
 *
 * Well-known keys:
 *   - `no_layout`: when true, the public page is served as bare HTML
 *     (no theme chrome). The runtime's post dispatcher checks this
 *     before rendering and redirects to the unified `/_/<slug>` route
 *     handler.
 *
 * Additional keys are passed through unchanged — themes and plugins
 * are free to store their own per-post state here (e.g. SEO overrides,
 * feature flags, A/B variants).
 */
export interface PostMetadata {
  no_layout?: boolean
  [key: string]: unknown
}

export interface Post {
  postId: string
  slug: string
  title: string
  excerpt?: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata
}

export interface Page {
  pageId: string
  slug: string
  title: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  publishedAt?: string
}

export interface Media {
  mediaId: string
  src: string
  mimeType: string
  size: number
  delivery: 'nextjs' | 's3-direct'
}

export type ImageDisplay = 'inline' | 'lightbox'

/**
 * How dates (publishedAt etc.) are rendered on public pages.
 * - 'iso'    YYYY-MM-DD (default; SSR-safe, locale-neutral)
 * - 'locale' browser/server locale via Date.toLocaleDateString()
 *            (warning: server uses Node default locale, so SSR/CSR may diverge)
 * - 'long'   "April 27, 2026" (en-US long form)
 */
export type DateFormat = 'iso' | 'locale' | 'long'

export interface MediaProcessingDefaults {
  /** Clamp the longer edge to this many pixels (default 2400). */
  maxDimension?: number
  /** Default output format (default 'webp'). */
  format?: 'webp' | 'jpeg' | 'original'
  /** Lossy quality 0..1 used when format is lossy (default 0.85). */
  quality?: number
  /** Use lossless WebP for PNG inputs (default true). */
  losslessForPng?: boolean
}

export interface Config {
  site: {
    name: string
    url: string
    description?: string
  }
  media?: {
    delivery?: 'nextjs' | 's3-direct'
    /** How embedded images are presented on the public site. */
    imageDisplay?: ImageDisplay
    /** Max content width for inline images (CSS value, default '100%'). */
    imageMaxWidth?: string
    /** Defaults for the upload-time image processing UI. */
    processing?: MediaProcessingDefaults
  }
  /** How dates render on public pages. Default 'iso' (YYYY-MM-DD). */
  dateFormat?: DateFormat
  /**
   * IANA timezone for date display (e.g. 'Asia/Tokyo', 'America/New_York').
   * Default 'UTC'. Used so SSR and CSR always produce the same string —
   * relying on the runtime's local TZ would drift between Node (UTC in
   * production) and the browser.
   */
  timezone?: string
  /**
   * UI locale for the admin app. The scaffolded project ships
   * `locales/<code>.json` dictionaries; defaults are `en` and `ja`.
   * Add a new language by dropping `locales/<code>.json` in and
   * updating the dictionary map in `lib/i18n.ts`.
   */
  locale?: string
  /**
   * Active plugins. Each entry is the result of a plugin factory call
   * (e.g. `seoPlugin({ ... })`) or a raw AmplessPlugin object. Strings are
   * accepted for backward compatibility with the legacy v0 config but are
   * ignored by the runtime.
   */
  plugins?: Array<import('./plugin.js').AmplessPlugin | string>
}

export type Role = 'reader' | 'editor' | 'admin'

export interface AuthContext {
  userId: string
  role: Role
  source: 'cognito' | 'api-key' | 'mcp'
}
