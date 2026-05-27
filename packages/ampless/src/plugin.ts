import type { AmplessEvent, EventType } from './events.js'
import type { Post, Config } from './types.js'
import type { LocalizedString } from './theme.js'

export type TrustLevel = 'untrusted' | 'trusted' | 'privileged'

/**
 * Plugin capability declarations. The runtime uses this list for
 * declaration-vs-implementation reconciliation warnings and (in later
 * phases) for `allowCapabilities` gating in `cms.config.ts`.
 *
 * Phase 1 active capabilities:
 *   - `publicHead` / `publicBody`: descriptor-based head/body injection.
 *   - `metadata` / `eventHooks`: name-only declaration for existing surfaces.
 *
 * Reserved capabilities are accepted by the type so that plugins can
 * declare future intent, but the runtime does nothing with them yet —
 * each has its own RFP under `docs/tmp/`. Declaring a reserved
 * capability today is harmless, but the runtime won't expose any new
 * surface for it until the matching phase ships.
 */
export type PluginCapability =
  // Phase 1 active
  | 'publicHead'
  | 'publicBody'
  | 'metadata'
  | 'eventHooks'
  // Reserved (name-only; later phases)
  | 'adminSettings'
  | 'schema'
  | 'writePublicAsset'
  | 'contentFields'
  | 'adminPage'
  | 'serverRoute'
  | 'secretSettings'
  | 'network'
  | 'scheduler'
  | 'storageWrite'
  | 'privilegedSystem'

/**
 * Loading strategy for `script` / `inlineScript` descriptors.
 *
 *   - `afterInteractive` (default): load after hydration, non-blocking.
 *     The runtime adds `async` for external scripts when neither
 *     `async` nor `defer` is set explicitly. `inlineScript` is emitted
 *     inline as-is in Phase 1 (strategy is informational only for
 *     inline; see comments in `plugin-head.ts`).
 *   - `lazyOnload`: defer load further. Phase 1 maps this to `defer`
 *     for external scripts; full lazy-load (next/script's idle
 *     scheduling) is a future enhancement.
 *
 * `beforeInteractive` is intentionally excluded — App Router does not
 * support emitting plain `<script>` elements that block hydration from
 * the runtime layer, and the spec defers that case to the future
 * developer extension surface.
 */
export type ScriptStrategy = 'afterInteractive' | 'lazyOnload'

/**
 * Context passed to `publicHead` / `publicBodyEnd`. Phase 1 carries
 * only the site-wide config block; per-route and per-post context lands
 * in Phase 4 (`plugin-per-post-rfp.md`). Plugin settings are read from
 * the factory closure today — Phase 2 (`plugin-settings-rfp.md`) adds
 * an admin-managed accessor here.
 */
export interface PluginPublicRenderContext {
  site: Config['site']
}

/**
 * Descriptor returned by `publicHead()`. The runtime validates each
 * entry (URL scheme denylist, `attrs` allowlist, id collision handling)
 * and renders the surviving descriptors as React elements inside the
 * root layout's `<head>`. Returning arbitrary `ReactNode` is
 * intentionally not offered here — see
 * `docs/architecture/08-plugin-architecture.md` §"Descriptor-based
 * Head/Body Injection".
 */
export type PublicHeadDescriptor =
  | {
      type: 'script'
      /** Element id; doubles as the duplicate-detection key. */
      id?: string
      src: string
      strategy?: ScriptStrategy
      async?: boolean
      defer?: boolean
      /** Allow-listed attributes only (data-*, crossorigin, referrerpolicy, ...). */
      attrs?: Record<string, string | boolean>
    }
  | {
      type: 'inlineScript'
      /** Required for duplicate detection and dev warnings. */
      id: string
      body: string
      strategy?: ScriptStrategy
      /**
       * Type-only reservation. CSP nonce resolution (including the
       * planned `'auto'` mode) is deferred to a future RFP; Phase 1
       * does not propagate this field to the rendered element.
       */
      nonce?: string
    }
  | {
      type: 'meta'
      name?: string
      property?: string
      content: string
    }
  | {
      type: 'link'
      rel: string
      href: string
      as?: string
      /** Mapped to React's `type` attribute. */
      typeAttr?: string
    }
  | {
      type: 'noscript'
      id?: string
      /** Raw HTML emitted inside `<noscript>`. */
      html: string
    }

/**
 * Descriptor returned by `publicBodyEnd()`. Supports the same
 * `script` / `inlineScript` / `noscript` variants as the head, plus
 * the body-only `iframe` variant (used by Google Tag Manager's
 * `<noscript>`-style fallback frame, chat widgets, etc.).
 */
export type PublicBodyDescriptor =
  | Extract<PublicHeadDescriptor, { type: 'script' | 'inlineScript' | 'noscript' }>
  | {
      type: 'iframe'
      id?: string
      src: string
      title?: string
      width?: number
      height?: number
      attrs?: Record<string, string | boolean>
    }

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
  /**
   * Stable per-install namespace. Defaults to `name` when omitted.
   * Distinguishes multiple instances of the same plugin (e.g. two GTM
   * containers, two GA4 measurement IDs). Multi-instance run-time
   * validation lands in Phase 3; Phase 1 only adds the field so plugin
   * authors can author against it now.
   */
  instanceId?: string
  /**
   * Human-readable label for admin UI surfaces (Phase 2 onward).
   * Plain string or per-locale map — see `LocalizedString`.
   */
  displayName?: LocalizedString
  /**
   * Declared capability list. The runtime uses this for
   * declaration-vs-implementation warnings (e.g. a plugin that
   * declares `publicBody` but defines no `publicBodyEnd`); later
   * phases will gate dangerous capabilities through `cms.config.ts`
   * `allowCapabilities`. Existing plugins that omit this field
   * continue to work unchanged.
   */
  capabilities?: readonly PluginCapability[]
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
   * Declarative head injection. Returns a list of validated
   * descriptors (script / inlineScript / meta / link / noscript). The
   * runtime collects every plugin's contribution at render time, runs
   * URL scheme + attrs validation, then emits React elements inside
   * the root layout's `<head>`. See `PublicHeadDescriptor`.
   */
  publicHead?(ctx: PluginPublicRenderContext): readonly PublicHeadDescriptor[]
  /**
   * Same shape as `publicHead`, but the result is appended at the
   * end of `<body>` and additionally supports the `iframe` variant
   * (GTM no-script fallback frame, chat widgets, ...).
   */
  publicBodyEnd?(ctx: PluginPublicRenderContext): readonly PublicBodyDescriptor[]
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
