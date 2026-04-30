export type ContentFormat = 'tiptap' | 'markdown' | 'html'

export type PostStatus = 'draft' | 'published'

export interface Post {
  postId: string
  siteId: string
  slug: string
  title: string
  excerpt?: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  publishedAt?: string
  tags?: string[]
}

export interface Page {
  pageId: string
  siteId: string
  slug: string
  title: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  publishedAt?: string
}

export interface Media {
  mediaId: string
  siteId: string
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
  sites?: Record<string, { domains: string[] }>
  plugins?: string[]
}

export type Role = 'reader' | 'editor' | 'admin'

export interface AuthContext {
  userId: string
  role: Role
  source: 'cognito' | 'api-key' | 'mcp'
}
