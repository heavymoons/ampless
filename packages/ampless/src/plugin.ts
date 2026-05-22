import type { AmplessEvent, EventType } from './events.js'
import type { Post, Config } from './types.js'

export type TrustLevel = 'untrusted' | 'trusted' | 'privileged'

/**
 * Metadata-like object that maps cleanly onto Next.js `Metadata`. We keep
 * the shape framework-agnostic so the core type doesn't depend on Next.js.
 */
export interface PluginMetadata {
  title?: string
  description?: string
  openGraph?: {
    title?: string
    description?: string
    type?: string
    url?: string
    images?: Array<{ url: string; width?: number; height?: number; alt?: string }>
  }
  twitter?: {
    card?: 'summary' | 'summary_large_image' | 'app' | 'player'
    site?: string
    creator?: string
    title?: string
    description?: string
    images?: string[]
  }
  alternates?: {
    canonical?: string
    types?: Record<string, string> // e.g. { 'application/rss+xml': '/feed.xml' }
  }
}

export type PluginEventHandler<T extends EventType = EventType> = (
  event: AmplessEvent<T>,
  ctx: PluginRuntimeContext
) => Promise<void>

/**
 * Runtime services injected into hook handlers by the Lambda processor.
 * Decoupling plugins from concrete AWS clients lets us swap implementations
 * (sandbox, tests) without touching plugin code.
 */
export interface PluginRuntimeContext {
  /** Read-only view of the cms.config site block (name, url, description). */
  site: Config['site']
  /** Read all published posts (used by sitemap/RSS). */
  listPublishedPosts(): Promise<Post[]>
  /**
   * Persist a file under `public/plugins/{pluginName}/{key}` in the
   * S3 bucket. Returns the public URL.
   */
  writePublicAsset(key: string, body: string | Uint8Array, contentType: string): Promise<string>
}

/**
 * A font registered with a plugin's OG image renderer. Satori (the engine
 * inside Next.js `ImageResponse`) requires at least one font. We accept
 * either eager `ArrayBuffer` data or a lazy loader so plugins can be
 * imported without forcing the font fetch — the loader runs once per route
 * invocation when the OG image is actually requested.
 */
export interface OgImageFont {
  name: string
  data: ArrayBuffer | (() => Promise<ArrayBuffer>)
  weight?: number
  style?: 'normal' | 'italic'
}

/**
 * Context passed to a plugin's `ogImage.render`. The `image` helper fetches
 * and decodes an image URL (WebP / AVIF → PNG) and returns a data URL
 * usable inside the JSX, or null on fetch failure / unsupported format.
 */
export interface OgImageRenderContext {
  post: Post
  site: Config['site']
  image(url: string): Promise<string | null>
}

export interface OgImageConfig {
  fonts: OgImageFont[]
  size?: { width: number; height: number }
  /**
   * Plugin authors return a React element. Typed loosely (`unknown`) here
   * to avoid pulling React into ampless core's runtime / type
   * dependencies — the OG image plugin package types it precisely on its
   * side.
   */
  render(ctx: OgImageRenderContext): Promise<unknown> | unknown
}

export interface AmplessPlugin {
  name: string
  /** Plugin API version. Currently 1; future versions will be additive. */
  apiVersion: 1
  trust_level: TrustLevel
  /** Async event hooks. Run in trust_level-matched Lambda. */
  hooks?: {
    [K in EventType]?: PluginEventHandler<K>
  }
  /**
   * Per-post metadata generator. Pure function, called from Next.js
   * generateMetadata(). Must not have side effects.
   */
  metadata?(post: Post, site: Config['site']): PluginMetadata
  /**
   * Site-level metadata (root layout). Returned per request.
   */
  siteMetadata?(site: Config['site']): PluginMetadata
  /**
   * Dynamic OG image renderer. The dispatcher route (e.g.
   * `app/og/[slug]/route.ts`) reads this and feeds the element into
   * Next.js `ImageResponse`. Only one plugin should set this — the
   * route resolves the first plugin in `cms.config.plugins` that
   * declares `ogImage`.
   */
  ogImage?: OgImageConfig
}

export function definePlugin(p: AmplessPlugin): AmplessPlugin {
  return p
}
