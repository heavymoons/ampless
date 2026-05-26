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
 * Per-post cache strategy. Middleware computes the response's
 * Cache-Control header from this value (plus `post.updatedAt` for the
 * `auto` case and the project's `cms.config.cache.*` knobs).
 *
 *   - `'auto'` (default): cooldown by edit time. Posts updated within
 *     the cooldown window (`cms.config.cache.cooldownMs`, default 1h)
 *     emit a no-store header so editors see fresh content immediately.
 *     Older posts emit a long s-maxage so the CDN serves them cheaply.
 *   - `'deep'`: always long-cache (`cms.config.cache.deepTtlSeconds`,
 *     default 1h). Use for posts whose content is fixed for the
 *     foreseeable future.
 *   - `'hot'`: always no-store. Use for posts whose content is rapidly
 *     evolving or computed per request.
 */
export type CacheStrategy = 'auto' | 'deep' | 'hot'

/**
 * Free-form per-post metadata. The `metadata` JSON column carries
 * arbitrary key/value pairs; the runtime / themes / plugins each pick
 * the keys they care about. A handful of well-known keys are owned by
 * ampless itself and documented here.
 *
 * Well-known keys:
 *   - `no_layout`: when true, the public page is served as bare HTML
 *     (no theme chrome). Middleware rewrites the request to the
 *     internal `/raw/<slug>` handler for such posts and renders the
 *     body verbatim — no Next.js root layout, no theme chrome.
 *   - `cache`: see `CacheStrategy`. Overrides the default 'auto'
 *     cache strategy for this post. Independent of `no_layout` —
 *     applies uniformly to themed, no_layout, and static posts.
 *
 * Additional keys are passed through unchanged — themes and plugins
 * are free to store their own per-post state here (e.g. SEO overrides,
 * feature flags, A/B variants).
 */
/**
 * Per-file metadata recorded on a static post. The static route
 * reads this to decide whether to stream the bytes back through
 * Lambda (small files → cached by CloudFront) or to 302-redirect
 * to a presigned URL (large files → bypass the Lambda response
 * size envelope). Populated by `upload_static_bundle` /
 * `commit_static_post` at upload time so the read path never
 * issues a HEAD round-trip.
 *
 * `body.files` (the manifest's flat list) stays the source of truth
 * for "what's in the bundle"; this map is purely a delivery hint and
 * may be sparse when older bundles predate the migration.
 */
export interface StaticPostFileMeta {
  size: number
  mimeType: string
}

export interface PostMetadata {
  no_layout?: boolean
  cache?: CacheStrategy
  /**
   * For `format: 'static'` posts only. Keyed by the bundle-relative
   * path (same shape as `body.files` entries). Older bundles may
   * lack this map — readers MUST treat a missing entry as
   * "fall back to a HEAD lookup".
   */
  files?: Record<string, StaticPostFileMeta>
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
  /**
   * DynamoDB auto-managed timestamp (ISO 8601). Surfaced through the
   * `PublicPost` projection so middleware can compute the
   * `metadata.cache='auto'` cooldown without re-fetching the model
   * row. Absent on optimistically-constructed posts (e.g. test
   * fixtures); the cache strategy treats absent values as "very old"
   * and emits a long s-maxage.
   */
  updatedAt?: string
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

/**
 * Asset metadata recorded on the Media row. Currently the only
 * well-known key is `etag` (the S3 object ETag, captured at upload
 * time so the media-proxy route can emit it back to the client
 * without a HEAD round-trip). Free-form by design — themes and
 * plugins can add their own keys (image dimensions, EXIF strip
 * status, etc.) without a schema change.
 */
export interface MediaMetadata {
  etag?: string
  [key: string]: unknown
}

export interface Media {
  mediaId: string
  src: string
  mimeType: string
  size: number
  delivery: 'nextjs' | 's3-direct'
  metadata?: MediaMetadata
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
   * (e.g. `seoPlugin({ ... })`) or a raw AmplessPlugin object. Strings
   * are accepted by the type for tolerance but are ignored by the
   * runtime — only factory results and plugin objects take effect.
   */
  plugins?: Array<import('./plugin.js').AmplessPlugin | string>
  /**
   * Cache strategy knobs read by the runtime's middleware when
   * computing `Cache-Control` for post responses. Each field is
   * optional — middleware applies the documented defaults when a
   * field is absent.
   */
  cache?: CacheConfig
}

/**
 * Tunables for middleware-computed `Cache-Control`. See
 * `PostMetadata.cache` / `CacheStrategy` for how the per-post override
 * interacts with these defaults.
 */
export interface CacheConfig {
  /**
   * `cache: 'auto'` cooldown. Posts whose `updatedAt` is younger than
   * this many milliseconds emit a no-store header so editors see
   * fresh content immediately after a save. Default 3,600,000 (1h).
   */
  cooldownMs?: number
  /**
   * `cache: 'auto'` post-cooldown TTL, in seconds. Applied as both
   * `max-age` and `s-maxage` on the response. Default 300 (5 minutes).
   */
  freshTtlSeconds?: number
  /**
   * `cache: 'deep'` TTL, in seconds. Applied as both `max-age` and
   * `s-maxage`. Default 3600 (1 hour).
   */
  deepTtlSeconds?: number
}

export type Role = 'reader' | 'editor' | 'admin'

export interface AuthContext {
  userId: string
  role: Role
  source: 'cognito' | 'api-key' | 'mcp'
}
