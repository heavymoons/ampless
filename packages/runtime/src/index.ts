// @ampless/runtime — public-side runtime for ampless.
//
// Templates wire this up once in `lib/ampless.ts`:
//
//     import outputs from '../amplify_outputs.json'
//     import cmsConfig from '../cms.config'
//     import { themes, DEFAULT_THEME } from '../themes-registry'
//     import { createAmpless } from '@ampless/runtime'
//
//     export const ampless = createAmpless({
//       outputs,
//       cmsConfig,
//       themes: { themes, defaultTheme: DEFAULT_THEME },
//     })
//
// and then hand the resulting `Ampless` instance to route handlers,
// dispatchers, and theme components.

import type { Post, Config, ThemeManifest } from 'ampless'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import type { AmplessOutputs } from './outputs.js'
import { createStorage, type StorageApi } from './storage.js'
import {
  createPostsApi,
  type PostsApi,
  type ListPostsOptions,
  type ListPostsByTagOptions,
  type ListPostsResult,
} from './posts.js'
import {
  createMediaApi,
  type MediaApi,
  type ResolvedMedia,
} from './media.js'
import {
  createSiteSettings,
  type SiteSettingsApi,
  type EffectiveSiteSettings,
} from './site-settings.js'
import { createSeo, type SeoApi } from './seo.js'
import {
  createPluginHead,
  type PluginHeadApi,
  type PublicHtmlForPostResult,
} from './plugin-head.js'
import {
  createPluginSettings,
  type PluginSettingsApi,
  type PluginSettingsSnapshot,
} from './plugin-settings.js'
import {
  createThemeActive,
  type ThemeActiveApi,
  type ThemesRegistry,
  type ResolvedTheme,
} from './theme-active.js'
import {
  createThemeConfig,
  type ThemeConfigApi,
  type EffectiveThemeConfig,
  renderThemeCss,
} from './theme-config.js'
import { renderBody } from './rendering.js'

export type {
  AmplessOutputs,
  StorageOutput,
  DataOutput,
} from './outputs.js'
export type {
  PostsApi,
  ListPostsOptions,
  ListPostsByTagOptions,
  ListPostsResult,
  PublicPostShape,
  PublicPostConnectionShape,
} from './posts.js'
export type {
  MediaApi,
  ResolvedMedia,
  PublicMediaShape,
} from './media.js'
export type {
  SiteSettingsApi,
  EffectiveSiteSettings,
} from './site-settings.js'
export type { SeoApi } from './seo.js'
export { createPluginHead, escapeJsonLdInlineBody } from './plugin-head.js'
export {
  loadPackageManifest,
  SUPPORTED_API_VERSION,
} from './plugin-package-manifest.js'
export type { PluginHeadApi } from './plugin-head.js'
export { createPluginSettings } from './plugin-settings.js'
export type { PluginSettingsApi, PluginSettingsSnapshot } from './plugin-settings.js'
export type {
  ThemeActiveApi,
  ThemesRegistry,
  ResolvedTheme,
} from './theme-active.js'
export type {
  ThemeConfigApi,
  EffectiveThemeConfig,
  ColorScheme,
} from './theme-config.js'
export {
  renderThemeCss,
  validateColorScheme,
  DEFAULT_COLOR_SCHEME,
  COLOR_SCHEME_SETTING_KEY,
} from './theme-config.js'
export {
  renderBody,
  tiptapToHtml,
  markdownToHtml,
  tiptapToMarkdown,
  htmlToMarkdown,
} from './rendering.js'
export {
  streamS3Object,
  streamS3ObjectWithRunner,
  _resetStreamS3Cache,
} from './stream-s3.js'
export type {
  ResolvedAssetMeta,
  StreamS3Options,
} from './stream-s3.js'

export interface CreateAmplessOpts {
  outputs: AmplessOutputs
  cmsConfig: Config
  themes: ThemesRegistry
}

export interface Ampless {
  // post fetching (server-side, uses generateServerClientUsingCookies
  // with apiKey authMode)
  listPublishedPosts(opts?: ListPostsOptions): Promise<ListPostsResult>
  getPublishedPost(slug: string): Promise<Post | null>
  listPostsByTag(tag: string, opts?: ListPostsByTagOptions): Promise<ListPostsResult>

  // media row resolution (server-side, public apiKey authMode)
  /**
   * Look up the Media DynamoDB row by S3 key. Returns `null` for
   * orphan / legacy assets (which the media-proxy route falls back
   * to a HEAD lookup for). Failures are logged and surface as null.
   */
  getMediaBySrc(src: string): Promise<ResolvedMedia | null>

  // settings + theme
  loadSiteSettings(): Promise<EffectiveSiteSettings>
  resolveActiveTheme(): Promise<ResolvedTheme>
  /**
   * Fresh-read of the stored `theme.active` value from S3, bypassing
   * the Next.js fetch cache. Returns the raw stored name (no fallback
   * to defaultTheme) or `null` when the cache file is missing. Used
   * by the admin to poll for processor propagation after a switch.
   */
  readStoredActiveThemeFresh(): Promise<string | null>
  loadThemeConfig(): Promise<EffectiveThemeConfig>

  // metadata
  postMetadata(post: Post): Promise<Metadata>
  siteMetadata(): Promise<Metadata>

  // descriptor-based plugin head/body injection (Phase 1) +
  // admin-managed `settings.public` accessor (Phase 2). Both methods
  // are async because they read from the S3 site-settings cache to
  // resolve `ctx.setting(key)`; Next.js dedupes the underlying fetch
  // within a single request, so calling both per layout is a single
  // network round trip. Drop the return values directly inside
  // `<head>` / before `</body>` in the root layout — see
  // templates/_shared/app/layout.tsx.
  publicHead(): Promise<ReactNode>
  publicBodyEnd(): Promise<ReactNode>
  /**
   * Per-post body descriptors (Phase 4 `schema` capability). Theme
   * post templates render the result so plugins like
   * `@ampless/plugin-schema-jsonld` can emit
   * `<script type="application/ld+json">` Article schema keyed off
   * the specific post being viewed. Limited to inline-script
   * descriptors with `scriptType: 'application/ld+json'` — the
   * runtime auto-escapes `<`, `>`, `&`, U+2028, U+2029 in the body.
   */
  publicBodyForPost(post: Post): Promise<ReactNode>
  /**
   * Per-post visible HTML aggregated across all installed plugins
   * (Phase 6d `publicHtmlForPost` capability). Returns a position-
   * bucketed result — themes embed `{html.beforeContent}` and
   * `{html.afterContent}` around the post body. The runtime sanitizes
   * every descriptor body with `sanitize-html` under a strict allowlist
   * before wrapping it in a keyed `<div>` — themes never call
   * `dangerouslySetInnerHTML` themselves.
   */
  publicHtmlForPost(post: Post): Promise<PublicHtmlForPostResult>

  // rendering
  renderBody(post: Post): string
  renderThemeCss(cssVars: Record<string, string>): string

  // storage
  publicAssetUrl(key: string): string
  isStorageConfigured(): boolean

  // shape for handing to dispatchers / route factories
  readonly outputs: AmplessOutputs
  readonly cmsConfig: Config
  readonly themes: ThemesRegistry

  // sub-APIs (escape hatch for advanced wiring)
  readonly posts: PostsApi
  readonly media: MediaApi
  readonly settings: SiteSettingsApi
  readonly seo: SeoApi
  readonly themeActive: ThemeActiveApi
  readonly themeConfig: ThemeConfigApi
  readonly storageApi: StorageApi
  readonly pluginHead: PluginHeadApi
  readonly pluginSettings: PluginSettingsApi
}

/**
 * Wire up the ampless runtime from user-supplied config blobs. The
 * returned `Ampless` instance is the single object handed to route
 * dispatchers / metadata factories / middleware — each sub-API
 * (posts, settings, themes, ...) is also available individually on
 * the instance for cases where a thin handler only needs one piece.
 */
export function createAmpless(opts: CreateAmplessOpts): Ampless {
  const { outputs, cmsConfig, themes } = opts
  const storage = createStorage(outputs)
  const posts = createPostsApi(outputs)
  const media = createMediaApi(outputs)
  const settings = createSiteSettings(cmsConfig, storage)
  const seo = createSeo(cmsConfig, settings)
  const pluginSettings = createPluginSettings(storage)
  const pluginHead = createPluginHead(cmsConfig, pluginSettings)
  const themeActive = createThemeActive(themes, storage)
  const themeConfig = createThemeConfig(themeActive, storage)

  return {
    listPublishedPosts: (o) => posts.listPublishedPosts(o),
    getPublishedPost: (slug) => posts.getPublishedPost(slug),
    listPostsByTag: (tag, o) => posts.listPostsByTag(tag, o),

    getMediaBySrc: (src) => media.getMediaBySrc(src),

    loadSiteSettings: () => settings.loadSiteSettings(),
    resolveActiveTheme: () => themeActive.resolveActiveTheme(),
    readStoredActiveThemeFresh: () => themeActive.readStoredActiveThemeFresh(),
    loadThemeConfig: () => themeConfig.loadThemeConfig(),

    postMetadata: (post) => seo.postMetadata(post),
    siteMetadata: () => seo.siteMetadata(),

    publicHead: () => pluginHead.renderHead(),
    publicBodyEnd: () => pluginHead.renderBodyEnd(),
    publicBodyForPost: (post) => pluginHead.renderBodyForPost(post),
    publicHtmlForPost: (post) => pluginHead.renderHtmlForPost(post),

    renderBody: (post) => renderBody(post),
    renderThemeCss: (cssVars) => renderThemeCss(cssVars),

    publicAssetUrl: (key) => storage.publicAssetUrl(key),
    isStorageConfigured: () => storage.isStorageConfigured(),

    outputs,
    cmsConfig,
    themes,

    posts,
    media,
    settings,
    seo,
    themeActive,
    themeConfig,
    storageApi: storage,
    pluginHead,
    pluginSettings,
  }
}

// Re-export selected ampless types so consumers can `import type { Post,
// Config, ThemeManifest } from '@ampless/runtime'` without juggling two
// package names. This is a convenience, not a replacement — anything
// not directly used by the runtime API stays in `ampless`.
export type { Post, Config, ThemeManifest }
export type { PublicHtmlForPostResult }
