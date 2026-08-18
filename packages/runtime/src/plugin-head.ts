// Descriptor-based head/body injection — Phase 1 of plugin extension.
//
// Plugins declare what they want to put into `<head>` / end-of-`<body>`
// as plain data (`PublicHeadDescriptor` / `PublicBodyDescriptor`).
// This module collects those declarations across every active plugin
// and turns the surviving entries into React elements that the root
// layout slots in directly.
//
// The validation step is the safety boundary: untrusted plugins should
// not be able to return arbitrary `ReactNode`, which would re-open
// SSR-time code execution. We enforce:
//
//   - URL scheme allowlist (http / https / relative paths only) on
//     `script.src`, `link.href`, `iframe.src`
//   - `attrs` allowlist (data-* / a small set of well-known safe
//     attributes) on `script` and `iframe`
//   - `inlineScript.id` required (used for duplicate detection)
//   - duplicate `id` → keep the last one and warn
//
// Failures fall through to silent skip in production; in development
// (`process.env.NODE_ENV !== 'production'`) we additionally log a
// `console.warn` so plugin authors can spot the problem.
//
// Architecture: https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture — public head/body descriptors.

import { headers } from 'next/headers'
import {
  Fragment,
  createElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import sanitizeHtml from 'sanitize-html'
import {
  isValidPluginKey,
  resolvePluginSettings,
  type AmplessPlugin,
  type Config,
  type PluginCapability,
  type PluginPublicRenderContext,
  type Post,
  type PublicHeadDescriptor,
  type PublicBodyDescriptor,
  type PublicPostBodyDescriptor,
  type PublicPostHtmlDescriptor,
  type PublicPostHtmlPosition,
  type PublicPostScriptDescriptor,
  type TiptapNodeMarkdownAdapters,
} from 'ampless'
import type { PluginSettingsApi, PluginSettingsSnapshot } from './plugin-settings.js'
import type { SiteSettingsApi } from './site-settings.js'
import {
  buildContentFieldRegistry,
  buildMarkdownAdapterRegistry,
  type ContentFieldRegistry,
} from './rendering.js'
import {
  loadPackageManifest,
  SUPPORTED_API_VERSION,
} from './plugin-package-manifest.js'
import {
  AMPLESS_PATHNAME_HEADER,
  PREVIEW_THEME_HEADER,
  PREVIEW_COLOR_SCHEME_HEADER,
} from './request-headers.js'

// Same guard as seo.ts — accept anything that looks like a plugin
// manifest (`apiVersion` is the cheapest discriminator and exists on
// every plugin shipped through `definePlugin`).
function isPlugin(p: unknown): p is AmplessPlugin {
  return typeof p === 'object' && p !== null && 'apiVersion' in p
}

export interface PluginHeadApi {
  /**
   * React children safe to drop into `<head>`. Async because admin-
   * managed settings are read from S3 on the first call per request.
   * Within a single request both `renderHead` and `renderBodyEnd` share
   * the same fetched snapshot via Next.js fetch dedup on the
   * `site-settings` cache tag.
   */
  renderHead(): Promise<ReactNode>
  /** React children safe to drop just before `</body>`. */
  renderBodyEnd(): Promise<ReactNode>
  /**
   * Per-post body descriptors (Phase 4). Themes call this from their
   * post template to render plugin-supplied `<script
   * type="application/ld+json">` descriptors keyed off the specific
   * post being viewed. Limited to `inlineScript` with
   * `scriptType: 'application/ld+json'` so the per-post surface stays
   * scoped to structured data — see `PublicPostBodyDescriptor`.
   */
  renderBodyForPost(post: Post): Promise<ReactNode>
  /**
   * Per-post visible HTML (Phase 6d). Aggregates all installed plugins'
   * `publicHtmlForPost` descriptors, sanitizes bodies under a strict
   * `sanitize-html` allowlist, resolves namespaces, deduplicates, and
   * returns position-bucketed ReactNodes ready to embed in theme post
   * templates. Themes never call `dangerouslySetInnerHTML` themselves.
   */
  renderHtmlForPost(post: Post): Promise<PublicHtmlForPostResult>
  /**
   * Page-level scripts aggregated across all installed plugins'
   * `publicPostScript(post, ctx)` (Phase 7 `publicPostScript`
   * capability). Themes invoke this via
   * `ampless.publicPostScriptsForPage(posts)` after rendering post
   * body / featured body. Descriptors are deduped by stable `id` so a
   * widget script (e.g. x.com `widgets.js`) emits at most once per
   * page regardless of how many embeds appear.
   */
  renderPostScriptsForPage(posts: readonly Post[]): Promise<ReactNode>
  /**
   * In-body content renderer registry (Phase 7 `contentFields`
   * capability). Built once at `createPluginHead` construction time so
   * duplicate `nodeType` / `pattern.source` registrations throw eagerly
   * (config error). Threaded into `rendering.ts:renderBody()` via
   * `Ampless.renderBody`. Returns `null` when no plugin registered any
   * `contentFields`.
   */
  readonly contentFieldsRegistry: ContentFieldRegistry
  /**
   * Merged tiptap→markdown adapter registry across all valid plugins
   * (server-safe `tiptapNodeToMarkdown` manifests). Built once at
   * `createPluginHead` construction time so duplicate `nodeType`
   * registrations across plugins throw eagerly (config error).
   * Threaded into `rendering.ts:postToMarkdown()` via
   * `Ampless.postToMarkdown`.
   */
  readonly markdownAdapters: TiptapNodeMarkdownAdapters
  /**
   * Resolve the per-plugin `PluginPublicRenderContext` snapshot used by
   * `contentFields` renderers. Same `settings()` binding the public
   * surfaces (`publicHead` / `publicBodyEnd`) use. Async because it reads
   * the S3 site-settings cache once per request — both plugin settings
   * (`pluginSettings.loadAll()`) AND, when `siteSettings` was passed to
   * `createPluginHead`, the effective `site` block
   * (`siteSettings.loadSiteSettings()`, admin overrides included; falls
   * back to `cmsConfig.site` on fetch failure or when `siteSettings` was
   * not supplied).
   */
  contextForPlugins(): Promise<(plugin: AmplessPlugin) => PluginPublicRenderContext>
  /**
   * Non-gated variant of `renderHead()` for use by the admin post preview.
   *
   * WHY this bypasses `isPublicRequest()`: the preview iframe is editor-only
   * and must faithfully show what the published article looks like — including
   * content-decoration plugins like mermaid/highlight that only register their
   * scripts via `publicHead`. The `isPublicRequest()` gate correctly blocks
   * analytics on public pages served to the admin or login routes, but for the
   * preview we intentionally collect ALL publicHead descriptors so diagrams and
   * syntax highlighting render. Analytics scripts (GA4/GTM/Plausible) also fire
   * on preview as a side-effect; this is accepted (preview is not end-user
   * traffic). Do NOT use this from public layouts — use `renderHead()` there.
   */
  renderHeadForPreview(): Promise<ReactNode>
}

/**
 * Position-bucketed result of `renderHtmlForPost`. Themes embed these
 * directly with `{html.beforeContent}` / `{html.afterContent}`. A `null`
 * slot means no plugins contributed HTML to that position.
 */
export interface PublicHtmlForPostResult {
  beforeContent: ReactNode | null
  afterContent: ReactNode | null
}

// Attribute allowlist for `attrs` on script/iframe descriptors. Any
// attribute not on this list (and not a `data-*` prefix) is dropped
// with a dev warning. Keep this list tight — adding entries here is
// effectively widening the public-page surface area.
const ALLOWED_ATTRS = new Set([
  'crossorigin',
  'referrerpolicy',
  'integrity',
  'fetchpriority',
  // `nonce` is intentionally NOT in the allowlist for Phase 1. CSP
  // nonce propagation is scoped out of Phase 1 (see spec §7); attrs
  // shouldn't let plugins smuggle nonces past the design decision.
  // The CSP nonce RFP will reintroduce it through `cspNonce` on
  // PluginPublicRenderContext + `inlineScript.nonce: 'auto'`, not via
  // the `attrs` bag.
  'loading', // iframe lazy-loading
  'sandbox', // iframe sandbox attribute
  'allow', // iframe permissions policy
  'allowfullscreen', // iframe fullscreen
])

function isAllowedAttr(name: string): boolean {
  if (name.startsWith('data-')) return true
  return ALLOWED_ATTRS.has(name.toLowerCase())
}

// URL scheme validator. Allows http / https / and any path that does
// not start with a scheme (relative paths `/foo`, `./foo`, `../foo`,
// bare `foo` etc.). Hard rejects `javascript:`, `data:` (any media
// type — we don't want `data:text/html` either), `vbscript:`, `blob:`,
// `file:`, ...
function isSafeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  // Scheme detection: anything matching `<word>:` at the start.
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  if (!schemeMatch) return true
  const scheme = schemeMatch[1]!.toLowerCase()
  return scheme === 'http' || scheme === 'https'
}

function isDev(): boolean {
  // Vitest doesn't set NODE_ENV automatically to 'test' on every run,
  // but warnings still surface there cleanly. We only suppress in
  // genuine production builds.
  const env =
    typeof process !== 'undefined' && process.env
      ? process.env.NODE_ENV
      : undefined
  return env !== 'production'
}

function warn(message: string): void {
  if (!isDev()) return
  // eslint-disable-next-line no-console
  console.warn(`[ampless plugin-head] ${message}`)
}

/**
 * Compare the plugin's static `amplessPlugin` manifest (in its
 * `package.json`) against the factory return value. Plugins that
 * supply a `packageName` opt in to this; plugins without
 * `packageName` skip the check entirely (backward compat).
 *
 * `apiVersion` mismatch — or a value above `SUPPORTED_API_VERSION` —
 * THROWS, because letting a plugin built against a future ampless
 * surface continue is genuinely unsafe (the runtime can't know which
 * methods it might call). All other field disagreements (`name`,
 * `trustLevel`, `capabilities`) warn so authors notice the drift in
 * dev without blocking site startup.
 *
 * Manifest load failures (missing package.json subpath export,
 * `amplessPlugin` field absent, JSON parse error) silently skip the
 * check — see `loadPackageManifest` for the failure modes. This keeps
 * the behaviour graceful for plugins that haven't migrated to the
 * Phase 5 convention.
 */
function crossCheckStaticManifest(plugin: AmplessPlugin, label: string): void {
  const packageName = plugin.packageName!
  const manifest = loadPackageManifest(packageName)
  if (!manifest) return

  // apiVersion: hard error. The plugin has declared the ampless API
  // version it was built against; if it's higher than the runtime
  // supports, the runtime literally doesn't know how to talk to it.
  if (typeof manifest.apiVersion !== 'number') {
    throw new Error(
      `${label}: package.json#amplessPlugin.apiVersion is not a number (got ${JSON.stringify(manifest.apiVersion)}). Update the plugin's package.json or remove the amplessPlugin field.`
    )
  }
  if (manifest.apiVersion > SUPPORTED_API_VERSION) {
    throw new Error(
      `${label}: package.json#amplessPlugin.apiVersion ${manifest.apiVersion} is newer than this runtime supports (max ${SUPPORTED_API_VERSION}). Upgrade @ampless/runtime, or pin an older version of the plugin.`
    )
  }
  if (manifest.apiVersion !== plugin.apiVersion) {
    throw new Error(
      `${label}: apiVersion mismatch — package.json declares ${manifest.apiVersion}, factory declares ${plugin.apiVersion}. The two must agree.`
    )
  }

  if (manifest.name !== plugin.name) {
    warn(
      `${label}: name mismatch — package.json#amplessPlugin.name is "${manifest.name}", factory returns name="${plugin.name}". Align them so admin UI / capability gates can identify the plugin consistently.`
    )
  }

  if (manifest.trustLevel !== plugin.trust_level) {
    warn(
      `${label}: trustLevel mismatch — package.json declares "${manifest.trustLevel}", factory declares trust_level="${plugin.trust_level}". The processor IAM policies are wired off trust_level; drift here usually means the deployment lambda runs in the wrong context.`
    )
  }

  const factoryCaps = Array.isArray(plugin.capabilities)
    ? (plugin.capabilities as readonly PluginCapability[])
    : ([] as readonly PluginCapability[])
  // `loadPackageManifest` already enforces that `manifest.capabilities`
  // is `Array<string>`, so the array shape here is guaranteed. The
  // `Array.isArray` guard above is for the factory side only, which
  // hasn't been structurally validated and could in theory be wrong.
  const manifestCaps = manifest.capabilities
  if (!setsEqual(factoryCaps, manifestCaps)) {
    warn(
      `${label}: capabilities mismatch — package.json declares [${manifestCaps.join(', ')}], factory declares [${factoryCaps.join(', ')}]. The static manifest is what npm registry / admin UI surfaces show before the plugin loads, so it should match what the factory actually returns.`
    )
  }
}

/**
 * Order-independent set comparison treating duplicates as one element
 * (so `['a','a']` equals `['a']`). Phase 5's cross-check uses this to
 * compare the static manifest's `capabilities` against the factory's;
 * either side accidentally duplicating an entry shouldn't be a false
 * positive in the mismatch warn.
 */
function setsEqual(
  a: readonly PluginCapability[],
  b: readonly PluginCapability[]
): boolean {
  const sa = new Set<string>(a)
  const sb = new Set<string>(b)
  if (sa.size !== sb.size) return false
  for (const c of sb) if (!sa.has(c)) return false
  return true
}

// Map allow-listed `attrs` onto a fresh React-friendly props object,
// dropping rejects with a dev warning. Boolean values become React
// boolean attributes; string values pass through.
function applyAttrs(
  target: Record<string, unknown>,
  attrs: Record<string, string | boolean> | undefined,
  ownerLabel: string
): void {
  if (!attrs) return
  for (const [k, v] of Object.entries(attrs)) {
    if (!isAllowedAttr(k)) {
      warn(
        `${ownerLabel}: attr "${k}" not in allowlist (data-* / crossorigin / referrerpolicy / integrity / fetchpriority / loading / sandbox / allow / allowfullscreen). skipping.`
      )
      continue
    }
    target[k] = v
  }
}

interface RenderedEntry {
  /** Stable identity for React keys; `null` when none could be derived. */
  id: string | null
  element: ReactElement
}

/**
 * Escape characters that would let a value break out of an inline
 * `<script type="application/ld+json">` body. Applied automatically by
 * the runtime to ANY inlineScript descriptor whose `scriptType` is
 * `'application/ld+json'`, regardless of which surface
 * (`publicHead` / `publicBodyEnd` / `publicBodyForPost`) emitted it.
 * Plugin authors do not need to call this themselves; it's exported so
 * other hand-rolled inline-JSON-LD code paths can reuse it.
 *
 * Each character is replaced with its `\uXXXX` form — a JSON-legal way
 * to encode the same character inside a JSON string, so the JSON
 * payload still parses but the HTML parser can no longer see a closing
 * `</script>` sequence:
 *
 *   '<'      → '\u003c'
 *   '>'      → '\u003e'
 *   '&'      → '\u0026'
 *   U+2028   → '\u2028'
 *   U+2029   → '\u2029'
 */
export function escapeJsonLdInlineBody(value: string): string {
  return value
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * scriptType policy per surface. `publicHead` / `publicBodyEnd` accept
 * `undefined` (= default JS, backwards compatible with existing
 * analytics-style inline scripts) or `'application/ld+json'`.
 * `publicBodyForPost` REQUIRES `'application/ld+json'` — the per-post
 * surface is scoped to JSON-LD only so the schema capability does not
 * become a per-post arbitrary inline-JS channel.
 */
type InlineSurface = 'head' | 'body-end' | 'body-for-post'

function inlineScriptTypeAllowed(
  surface: InlineSurface,
  scriptType: string | undefined,
): boolean {
  if (scriptType === 'application/ld+json') return true
  if (scriptType === undefined) {
    return surface === 'head' || surface === 'body-end'
  }
  return false
}

/**
 * Shared inlineScript → `<script>` element converter used by all three
 * surfaces. Centralised so:
 *   - The auto-escape for `application/ld+json` runs no matter which
 *     surface emitted the descriptor (`</script>` injection cannot
 *     sneak in via `publicHead` either).
 *   - The surface-dependent scriptType policy lives in one place.
 */
function renderInlineScript(
  descriptor: Extract<PublicHeadDescriptor, { type: 'inlineScript' }>,
  pluginLabel: string,
  index: number,
  surface: InlineSurface,
): RenderedEntry | null {
  // `id` is mandatory for inline scripts so collision detection works.
  // Without it we have no way to distinguish two plugins injecting
  // near-identical snippets.
  if (!descriptor.id) {
    warn(
      `${pluginLabel}: inlineScript descriptor #${index} dropped — missing required "id".`
    )
    return null
  }
  if (!inlineScriptTypeAllowed(surface, descriptor.scriptType)) {
    const got = descriptor.scriptType === undefined ? 'undefined' : `"${descriptor.scriptType}"`
    const allowed =
      surface === 'body-for-post'
        ? `"application/ld+json" (required on publicBodyForPost — the per-post surface is scoped to JSON-LD)`
        : `undefined or "application/ld+json"`
    warn(
      `${pluginLabel}: inlineScript "${descriptor.id}" dropped — scriptType ${got} not allowed on ${surface}. Allowed: ${allowed}.`
    )
    return null
  }
  // strategy is ignored for inline in Phase 1: the script runs wherever
  // the layout places it. Honoring 'lazyOnload' for inline would
  // require an idle-callback wrapper which we intentionally don't add
  // here. See spec §10.
  //
  // `nonce` (including the `'auto'` sentinel) is a Phase 1 reservation:
  // the type accepts it but the runtime intentionally does not propagate
  // it to the rendered element. The middleware/SSR CSP nonce threading
  // PR will land both the per-request `ctx.cspNonce` source and the
  // stamping logic together.
  const body =
    descriptor.scriptType === 'application/ld+json'
      ? escapeJsonLdInlineBody(descriptor.body)
      : descriptor.body
  const props: Record<string, unknown> = {
    id: descriptor.id,
    dangerouslySetInnerHTML: { __html: body },
  }
  if (descriptor.scriptType) props.type = descriptor.scriptType
  return {
    id: descriptor.id,
    element: createElement('script', props),
  }
}

function renderHeadDescriptor(
  descriptor: PublicHeadDescriptor,
  pluginLabel: string,
  index: number
): RenderedEntry | null {
  switch (descriptor.type) {
    case 'script': {
      if (!isSafeUrl(descriptor.src)) {
        warn(
          `${pluginLabel}: script descriptor #${index} dropped — unsafe src "${descriptor.src}".`
        )
        return null
      }
      const props: Record<string, unknown> = {
        src: descriptor.src,
      }
      if (descriptor.id) props.id = descriptor.id
      // Strategy → async/defer mapping. Explicit async/defer always
      // wins. For 'afterInteractive' (the default) we add `async`; for
      // 'lazyOnload' we add `defer`. Phase 1 keeps this simple; future
      // revisions can swap in next/script-style strategies without
      // changing the descriptor shape.
      const hasAsync = typeof descriptor.async === 'boolean'
      const hasDefer = typeof descriptor.defer === 'boolean'
      if (hasAsync) props.async = descriptor.async
      if (hasDefer) props.defer = descriptor.defer
      if (!hasAsync && !hasDefer) {
        if (descriptor.strategy === 'lazyOnload') {
          props.defer = true
        } else {
          props.async = true
        }
      }
      applyAttrs(props, descriptor.attrs, `${pluginLabel} script#${descriptor.id ?? index}`)
      // `descriptor.nonce` (including the `'auto'` sentinel) is a Phase 1
      // reservation: the type accepts it but the runtime intentionally does
      // not propagate it to the rendered element. The middleware/SSR CSP
      // nonce threading PR will land both the per-request `ctx.cspNonce`
      // source and the stamping logic together.
      return {
        id: descriptor.id ?? null,
        element: createElement('script', props),
      }
    }
    case 'inlineScript':
      // Delegated to the shared renderer so the auto-escape for
      // `application/ld+json` and the surface-dependent scriptType
      // policy live in one place. See renderInlineScript above.
      return renderInlineScript(descriptor, pluginLabel, index, 'head')
    case 'meta': {
      const props: Record<string, unknown> = { content: descriptor.content }
      if (descriptor.name) props.name = descriptor.name
      if (descriptor.property) props.property = descriptor.property
      return {
        // meta has no id channel in the descriptor. Don't derive a
        // dedup id from name/property — multiple `<meta name=...>`
        // entries with the same name are legitimate (e.g. theme-color
        // media variants, and two plugins emitting overlapping names
        // is a real case the runtime shouldn't silently collapse).
        // Position-based React keys handle the stable-key requirement.
        id: null,
        element: createElement('meta', props),
      }
    }
    case 'link': {
      if (!isSafeUrl(descriptor.href)) {
        warn(
          `${pluginLabel}: link descriptor #${index} dropped — unsafe href "${descriptor.href}".`
        )
        return null
      }
      const props: Record<string, unknown> = {
        rel: descriptor.rel,
        href: descriptor.href,
      }
      if (descriptor.as) props.as = descriptor.as
      // Spec uses `typeAttr` to avoid colliding with the descriptor
      // discriminator `type`. Map it back onto React's `type` prop.
      if (descriptor.typeAttr) props.type = descriptor.typeAttr
      return {
        id: null,
        element: createElement('link', props),
      }
    }
    case 'noscript': {
      const props: Record<string, unknown> = {
        dangerouslySetInnerHTML: { __html: descriptor.html },
      }
      if (descriptor.id) props.id = descriptor.id
      return {
        id: descriptor.id ?? null,
        element: createElement('noscript', props),
      }
    }
  }
}

function renderBodyDescriptor(
  descriptor: PublicBodyDescriptor,
  pluginLabel: string,
  index: number
): RenderedEntry | null {
  if (descriptor.type === 'iframe') {
    if (!isSafeUrl(descriptor.src)) {
      warn(
        `${pluginLabel}: iframe descriptor #${index} dropped — unsafe src "${descriptor.src}".`
      )
      return null
    }
    const props: Record<string, unknown> = {
      src: descriptor.src,
    }
    if (descriptor.id) props.id = descriptor.id
    if (descriptor.title) props.title = descriptor.title
    if (typeof descriptor.width === 'number') props.width = descriptor.width
    if (typeof descriptor.height === 'number') props.height = descriptor.height
    applyAttrs(props, descriptor.attrs, `${pluginLabel} iframe#${descriptor.id ?? index}`)
    return {
      id: descriptor.id ?? null,
      element: createElement('iframe', props),
    }
  }
  if (descriptor.type === 'inlineScript') {
    // Direct dispatch (not via renderHeadDescriptor) so the
    // surface-dependent scriptType policy and warn messages correctly
    // identify this as `body-end`, not `head`.
    return renderInlineScript(descriptor, pluginLabel, index, 'body-end')
  }
  // script / noscript variants share the head shape and have no
  // surface-dependent behaviour.
  return renderHeadDescriptor(descriptor, pluginLabel, index)
}

function renderPostBodyDescriptor(
  descriptor: PublicPostBodyDescriptor,
  pluginLabel: string,
  index: number
): RenderedEntry | null {
  // `publicBodyForPost` returns only `inlineScript` descriptors with
  // scriptType: 'application/ld+json'. The runtime guards the surface
  // here even though the type narrows it — a plugin that lies about
  // its descriptor shape (e.g. typeof / unsafe casts) still hits this
  // check and gets dropped.
  if (descriptor.type !== 'inlineScript') {
    warn(
      `${pluginLabel}: publicBodyForPost descriptor #${index} dropped — only inlineScript with scriptType "application/ld+json" is allowed on this surface.`
    )
    return null
  }
  return renderInlineScript(descriptor, pluginLabel, index, 'body-for-post')
}

/**
 * Deduplicate entries by `id` (last one wins) and rebuild each
 * surviving element with a React `key`. Entries without an id are
 * kept and keyed by their original index — distinct from any
 * id-bearing entry's key namespace.
 */
function dedupeAndKey(entries: RenderedEntry[]): ReactElement[] {
  const lastIndexById = new Map<string, number>()
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i]!.id
    if (id === null) continue
    if (lastIndexById.has(id)) {
      warn(`duplicate descriptor id "${id}" — keeping the last occurrence.`)
    }
    lastIndexById.set(id, i)
  }
  const kept: ReactElement[] = []
  for (let i = 0; i < entries.length; i++) {
    const { id, element } = entries[i]!
    if (id !== null && lastIndexById.get(id) !== i) continue
    const key = id ?? `__pos-${i}`
    // React needs `key` on array children. Cheapest way to attach it
    // without React.cloneElement: rebuild the element with the same
    // props plus the new key. `props` is `unknown` in React 19's
    // typings so we cast to a generic object before spreading.
    const existingProps = element.props as Record<string, unknown>
    kept.push(createElement(element.type as never, { ...existingProps, key }))
  }
  return kept
}

type Renderer<D> = (d: D, label: string, idx: number) => RenderedEntry | null

/**
 * Build a per-plugin `PluginPublicRenderContext` whose `setting<T>`
 * accessor is bound to that plugin's resolved settings snapshot.
 * The same context is handed to both `publicHead` and `publicBodyEnd`
 * for a single request — see `createPluginHead.renderHead/renderBodyEnd`.
 */
function makeCtx(
  plugin: AmplessPlugin,
  site: Config['site'],
  snapshot: PluginSettingsSnapshot
): PluginPublicRenderContext {
  const instanceId = plugin.instanceId ?? plugin.name
  const stored = snapshot.get(instanceId) ?? {}
  const resolved = resolvePluginSettings(plugin.settings, stored)
  return {
    site,
    setting<T = unknown>(key: string): T | undefined {
      if (!isValidPluginKey(key)) return undefined
      const v = resolved[key]
      return v === undefined ? undefined : (v as T)
    },
  }
}

/**
 * Resolve the `site` block handed to `ctx.site` across every plugin
 * public-render surface.
 *
 *   - `siteSettings` supplied (the `createAmpless` wiring passes the
 *     runtime's `SiteSettingsApi`): read the effective site settings
 *     (admin `settings.public` override merged over `cms.config.ts`
 *     defaults — same value the `.md` route's canonical line uses) via
 *     `siteSettings.loadSiteSettings()`. A fetch failure (S3 down,
 *     malformed cache JSON, ...) falls back to `cmsConfig.site` — this
 *     is the ONLY failure mode caught here; plugin settings errors are
 *     an entirely separate code path with their own existing contract.
 *   - `siteSettings` omitted (any direct `createPluginHead(cmsConfig,
 *     pluginSettings)` two-arg caller — the pre-existing public export
 *     contract): return `cmsConfig.site` synchronously-equivalent
 *     (wrapped in a resolved Promise so callers can `await` either
 *     branch uniformly). This is the backward-compatible path; see
 *     `plugin-head.test.ts` for the coverage that pins it.
 */
async function resolveEffectiveSite(
  cmsConfig: Config,
  siteSettings: SiteSettingsApi | undefined
): Promise<Config['site']> {
  if (!siteSettings) return cmsConfig.site
  try {
    const { site } = await siteSettings.loadSiteSettings()
    return site
  } catch (err) {
    warn(
      `effective site settings fetch failed — falling back to cms.config.ts site block: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return cmsConfig.site
  }
}

/**
 * Shared per-render resolution: the plugin settings snapshot (S3
 * site-settings cache, `pluginSettings.loadAll()`) and the effective
 * `site` block (see `resolveEffectiveSite`), fetched in parallel. Every
 * `PluginPublicRenderContext`-producing surface in `createPluginHead`
 * goes through this one function so there is a single place that knows
 * how to combine the two.
 */
async function resolveRenderContext(
  cmsConfig: Config,
  pluginSettings: PluginSettingsApi,
  siteSettings: SiteSettingsApi | undefined
): Promise<{ snapshot: PluginSettingsSnapshot; site: Config['site'] }> {
  const [snapshot, site] = await Promise.all([
    pluginSettings.loadAll(),
    resolveEffectiveSite(cmsConfig, siteSettings),
  ])
  return { snapshot, site }
}

function collectFor<D>(
  plugins: readonly AmplessPlugin[],
  site: Config['site'],
  snapshot: PluginSettingsSnapshot,
  surface: (p: AmplessPlugin) => ((c: PluginPublicRenderContext) => readonly D[]) | undefined,
  renderOne: Renderer<D>
): ReactNode {
  const entries: RenderedEntry[] = []
  for (const plugin of plugins) {
    const factory = surface(plugin)
    if (!factory) continue
    const ctx = makeCtx(plugin, site, snapshot)
    let descriptors: readonly D[]
    try {
      // The factory is a method on the plugin object; rebind via
      // `.call` so the plugin can use `this` if it chooses to (we
      // don't rely on that, but it's the least surprising semantics).
      descriptors = factory.call(plugin, ctx) ?? []
    } catch (err) {
      warn(
        `plugin "${plugin.instanceId ?? plugin.name}" threw inside descriptor callback: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      continue
    }
    const label = `plugin "${plugin.instanceId ?? plugin.name}"`
    for (let i = 0; i < descriptors.length; i++) {
      const entry = renderOne(descriptors[i]!, label, i)
      if (entry) entries.push(entry)
    }
  }
  if (entries.length === 0) return null
  const keyed = dedupeAndKey(entries)
  // Wrap in a Fragment so callers can interpolate
  // `{ampless.publicHead()}` directly in JSX without juggling array
  // children.
  return createElement(Fragment, null, ...keyed)
}

// ---------------------------------------------------------------------------
// Phase 6d — publicHtmlForPost: strict sanitize-html profile
//
// All trust levels (untrusted / trusted / privileged) go through the same
// strict sanitizer — no pass-through escape hatch in v1.
// ---------------------------------------------------------------------------

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'span', 'strong', 'em', 'a', 'code', 'br', 'ul', 'ol', 'li'],
  allowedAttributes: {
    '*': ['class', 'data-words', 'data-minutes', 'data-ampless-*'],
    a: ['href', 'rel', 'target'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      // <a target="_blank"> → force rel="noopener noreferrer"
      const out = { ...attribs }
      if (out['target'] === '_blank') {
        const parts = (out['rel'] ?? '').split(/\s+/).filter(Boolean)
        if (!parts.includes('noopener')) parts.push('noopener')
        if (!parts.includes('noreferrer')) parts.push('noreferrer')
        out['rel'] = parts.join(' ')
      }
      return { tagName, attribs: out }
    },
  },
}

/**
 * Validate the runtime shape of a `publicHtmlForPost` descriptor. The
 * type narrows it at compile time, but a plugin written in plain JS
 * or one that lies via unsafe casts can still hand us anything —
 * `undefined`, a string, an object with the wrong `type`, an unknown
 * `position`, etc. Without this guard the subsequent
 * `validateHtmlId(descriptor.id, ...)` / `sanitizeHtml(descriptor.body, ...)`
 * calls would throw `TypeError` and the runtime caller (here, the post
 * page render) would fail open with a stack trace.
 *
 * Matches the same defensive pattern used by
 * `renderPostBodyDescriptor` above: silently drop + warn anything
 * that doesn't conform, so one bad plugin can't take the whole post
 * down with it.
 */
function validateHtmlDescriptor(
  descriptor: unknown,
  pluginLabel: string,
  index: number
): descriptor is PublicPostHtmlDescriptor {
  if (descriptor === null || typeof descriptor !== 'object') {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor #${index} dropped — must be an object.`
    )
    return false
  }
  const d = descriptor as Record<string, unknown>
  if (d.type !== 'html') {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor #${index} dropped — "type" must be "html" (got ${typeof d.type === 'string' ? `"${d.type}"` : typeof d.type}).`
    )
    return false
  }
  if (typeof d.id !== 'string') {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor #${index} dropped — "id" must be a string.`
    )
    return false
  }
  if (typeof d.body !== 'string') {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor "${d.id}" dropped — "body" must be a string.`
    )
    return false
  }
  if (d.position !== 'beforeContent' && d.position !== 'afterContent') {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor "${d.id}" dropped — "position" must be "beforeContent" or "afterContent" (got ${typeof d.position === 'string' ? `"${d.position}"` : typeof d.position}).`
    )
    return false
  }
  return true
}

/**
 * Validate a plugin-local `id` string. Empty string, control characters,
 * and strings longer than 64 chars are rejected with a warning.
 * Prefix rules are not enforced — that is the plugin author's convention.
 */
function validateHtmlId(id: string, pluginLabel: string): boolean {
  if (id.length === 0) {
    warn(`${pluginLabel}: publicHtmlForPost descriptor dropped — "id" must not be empty.`)
    return false
  }
  if (/[\x00-\x1f]/.test(id)) {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor "${id}" dropped — "id" contains control characters.`
    )
    return false
  }
  if (id.length > 64) {
    warn(
      `${pluginLabel}: publicHtmlForPost descriptor "${id.slice(0, 32)}…" dropped — "id" exceeds 64 characters.`
    )
    return false
  }
  return true
}

/**
 * Per-post variant of `collectFor`. Same ctx-binding / dedup pipeline,
 * but invokes `plugin.publicBodyForPost(post, ctx)` so the plugin can
 * read post-scoped fields (title / excerpt / publishedAt / slug / ...).
 */
function collectForPost(
  plugins: readonly AmplessPlugin[],
  site: Config['site'],
  snapshot: PluginSettingsSnapshot,
  post: Post,
): ReactNode {
  const entries: RenderedEntry[] = []
  for (const plugin of plugins) {
    const factory = plugin.publicBodyForPost
    if (!factory) continue
    const ctx = makeCtx(plugin, site, snapshot)
    let descriptors: readonly PublicPostBodyDescriptor[]
    try {
      descriptors = factory.call(plugin, post, ctx) ?? []
    } catch (err) {
      warn(
        `plugin "${plugin.instanceId ?? plugin.name}" threw inside publicBodyForPost callback: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      continue
    }
    const label = `plugin "${plugin.instanceId ?? plugin.name}"`
    for (let i = 0; i < descriptors.length; i++) {
      const entry = renderPostBodyDescriptor(descriptors[i]!, label, i)
      if (entry) entries.push(entry)
    }
  }
  if (entries.length === 0) return null
  const keyed = dedupeAndKey(entries)
  return createElement(Fragment, null, ...keyed)
}

/**
 * Phase 6d aggregator: collect, sanitize, namespace-resolve, deduplicate,
 * and ReactNode-ify all `publicHtmlForPost` descriptors across plugins.
 *
 * Deduplication is position-scoped: `beforeContent` and `afterContent`
 * each maintain independent seen-id sets. The dedupe key is
 * `${namespace}:${id}` — two different plugin instances with the same
 * short `id` survive because their namespaces differ.
 */
function collectHtmlForPost(
  plugins: readonly AmplessPlugin[],
  site: Config['site'],
  snapshot: PluginSettingsSnapshot,
  post: Post,
): PublicHtmlForPostResult {
  // entries keyed by position
  const before: Array<{ key: string; cleanHtml: string; namespace: string }> = []
  const after: Array<{ key: string; cleanHtml: string; namespace: string }> = []
  const seenBefore = new Set<string>()
  const seenAfter = new Set<string>()

  for (const plugin of plugins) {
    const factory = plugin.publicHtmlForPost
    if (!factory) continue
    const namespace = plugin.instanceId ?? plugin.name
    const label = `plugin "${plugin.instanceId ?? plugin.name}"`
    const ctx = makeCtx(plugin, site, snapshot)
    let descriptors: readonly PublicPostHtmlDescriptor[]
    try {
      descriptors = factory.call(plugin, post, ctx) ?? []
    } catch (err) {
      warn(
        `${label}: threw inside publicHtmlForPost callback: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      continue
    }
    for (let i = 0; i < descriptors.length; i++) {
      const raw = descriptors[i]
      if (!validateHtmlDescriptor(raw, label, i)) continue
      const descriptor = raw
      if (!validateHtmlId(descriptor.id, label)) continue
      const dedupeKey = `${namespace}:${descriptor.id}`
      const position: PublicPostHtmlPosition = descriptor.position
      const seenSet = position === 'beforeContent' ? seenBefore : seenAfter
      const bucket = position === 'beforeContent' ? before : after
      if (seenSet.has(dedupeKey)) {
        warn(
          `${label}: publicHtmlForPost descriptor "${descriptor.id}" at position "${position}" is a duplicate — keeping the first occurrence.`
        )
        continue
      }
      seenSet.add(dedupeKey)
      const cleanHtml = sanitizeHtml(descriptor.body, SANITIZE_OPTIONS)
      bucket.push({ key: dedupeKey, cleanHtml, namespace })
    }
  }

  function toReactNode(
    entries: Array<{ key: string; cleanHtml: string; namespace: string }>,
    position: PublicPostHtmlPosition
  ): ReactNode | null {
    if (entries.length === 0) return null
    const elements = entries.map(({ key, cleanHtml, namespace }) =>
      createElement('div', {
        key,
        'data-ampless-plugin': namespace,
        'data-ampless-position': position,
        dangerouslySetInnerHTML: { __html: cleanHtml },
      })
    )
    return createElement(Fragment, null, ...elements)
  }

  return {
    beforeContent: toReactNode(before, 'beforeContent'),
    afterContent: toReactNode(after, 'afterContent'),
  }
}

/**
 * Create the head/body renderer for a `Config`. The constructor-time
 * pass logs a single dev warning when two plugins share an
 * `instanceId ?? name`; everything else happens at render time so
 * descriptors reflect per-request site config.
 *
 * `pluginSettings` (Phase 2) is the runtime accessor that pulls
 * admin-managed `settings.public` values from the S3 site-settings
 * cache. Within a single request we fetch once via `loadAll()` and
 * bind a per-plugin `ctx.setting(key)` accessor before invoking
 * either `publicHead` or `publicBodyEnd`.
 */

// ---------------------------------------------------------------------------
// Public-route guard for renderHead / renderBodyEnd
// ---------------------------------------------------------------------------

/**
 * Returns `true` only for public requests processed by the ampless
 * middleware (i.e. the middleware's `x-ampless-pathname` marker header
 * is present and the path is not an admin or login route).
 *
 * The middleware's matcher already excludes `/admin`, `/api`, and
 * `/login`, so the marker is absent on those routes by design. This
 * function adds a belt-and-braces path check for sites whose custom
 * matcher accidentally reaches those prefixes, and it also filters out
 * admin theme-preview requests (the `/?previewTheme=` iframe uses a
 * public URL but is admin-driven and must not fire analytics).
 *
 * Build-time pre-rendering and non-request contexts (event handlers,
 * etc.) throw inside `headers()` — those are caught and return `false`
 * silently; no log is needed because it's normal Next.js behaviour.
 */
async function isPublicRequest(): Promise<boolean> {
  let h: Awaited<ReturnType<typeof headers>>
  try {
    h = await headers()
  } catch {
    // Outside request scope (e.g. build-time prerender) — normal, no log needed.
    return false
  }
  const p = h.get(AMPLESS_PATHNAME_HEADER)
  if (!p) return false // no marker = a route the middleware doesn't run on (admin/api/login)
  // Belt-and-braces for sites whose custom matcher doesn't exclude admin/login.
  if (p === '/admin' || p.startsWith('/admin/')) return false
  if (p === '/login' || p.startsWith('/login/')) return false
  // Admin theme-settings live preview: the iframe opens /?previewTheme=…
  // on a public route (so the marker is set), but it's admin-driven.
  // Don't fire analytics or consent scripts for the admin's own previews.
  if (h.get(PREVIEW_THEME_HEADER) || h.get(PREVIEW_COLOR_SCHEME_HEADER)) return false
  return true
}

export function createPluginHead(
  cmsConfig: Config,
  pluginSettings: PluginSettingsApi,
  siteSettings?: SiteSettingsApi
): PluginHeadApi {
  const plugins = (cmsConfig.plugins ?? []).filter(isPlugin)

  // Constructor-time integrity checks. Cheaper here than per render,
  // and the warning lines plugin authors care about appear once at
  // startup instead of buried in render output.
  //
  // Plugin instances with an invalid `instanceId` are dropped from
  // the registered list, not skipped only per-render — the SK pattern
  // `plugins.<instanceId>.<key>` can't survive a dotted/slash/scope
  // id, so silently ignoring at every render would mask the misuse.
  const validPlugins: AmplessPlugin[] = []
  const seenNamespaces = new Set<string>()
  for (const plugin of plugins) {
    const ns = plugin.instanceId ?? plugin.name
    const label = plugin.instanceId
      ? `${plugin.name}#${plugin.instanceId}`
      : plugin.name

    // Reject invalid namespace at the runtime boundary. The instance
    // wouldn't be addressable by admin / processor anyway — better
    // surface the misconfiguration than render something that can't
    // be edited.
    if (!isValidPluginKey(ns)) {
      warn(
        `${label}: plugin namespace "${ns}" violates ${`/^[a-zA-Z0-9_-]+$/`}. Use a simple identifier (letters / digits / "-" / "_"). Skipping plugin.`
      )
      continue
    }

    // Duplicate namespaces — distinct plugin instances should declare
    // distinct `instanceId`s.
    if (seenNamespaces.has(ns)) {
      warn(
        `duplicate plugin namespace "${ns}" detected in cms.config.plugins. Set distinct \`instanceId\` on each instance to disambiguate.`
      )
    }
    seenNamespaces.add(ns)

    // Validate settings field keys (Phase 2). Invalid field keys
    // can't round-trip through DDB SK / S3 cache, so we drop them
    // here with a warning rather than letting admin save them and
    // wonder why nothing took effect. The field stays in the
    // manifest at the type level — but the runtime treats it as
    // missing.
    if (plugin.settings?.public) {
      for (const field of plugin.settings.public) {
        if (!isValidPluginKey(field.key)) {
          warn(
            `${label}: settings.public field key "${field.key}" violates ${`/^[a-zA-Z0-9_-]+$/`}. The field will not be readable through ctx.setting(). Rename the field key.`
          )
        }
      }
    }
    validPlugins.push(plugin)

    // Static-manifest cross-check (Phase 5). When the plugin declares
    // `packageName`, resolve `<packageName>/package.json#amplessPlugin`
    // and compare against the factory return value. apiVersion
    // mismatch (or above the supported value) throws — loading code
    // built against a future ampless surface is unsafe. Other field
    // mismatches warn so plugin authors notice the drift but the site
    // keeps running.
    if (plugin.packageName) {
      crossCheckStaticManifest(plugin, label)
    }

    // Capability vs implementation mismatch. We only check the head/
    // body surfaces this module is actually responsible for; other
    // capabilities (`metadata`, `eventHooks`, etc.) live elsewhere
    // and own their own consistency checks.
    const caps = plugin.capabilities
    if (caps) {
      if (caps.includes('publicHead') && !plugin.publicHead) {
        warn(
          `${label}: declares capability "publicHead" but no \`publicHead\` implementation. Drop the capability or add the function.`
        )
      }
      if (caps.includes('publicBody') && !plugin.publicBodyEnd) {
        warn(
          `${label}: declares capability "publicBody" but no \`publicBodyEnd\` implementation. Drop the capability or add the function.`
        )
      }
      if (plugin.publicHead && !caps.includes('publicHead')) {
        warn(
          `${label}: implements \`publicHead\` but "publicHead" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`
        )
      }
      if (plugin.publicBodyEnd && !caps.includes('publicBody')) {
        warn(
          `${label}: implements \`publicBodyEnd\` but "publicBody" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`
        )
      }
      if (caps.includes('schema') && !plugin.publicBodyForPost) {
        warn(
          `${label}: declares capability "schema" but no \`publicBodyForPost\` implementation. Drop the capability or add the function.`
        )
      }
      if (plugin.publicBodyForPost && !caps.includes('schema')) {
        warn(
          `${label}: implements \`publicBodyForPost\` but "schema" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`
        )
      }
      if (caps.includes('publicHtmlForPost') && !plugin.publicHtmlForPost) {
        warn(
          `${label}: declares capability "publicHtmlForPost" but no \`publicHtmlForPost\` implementation. Drop the capability or add the function.`
        )
      }
      if (plugin.publicHtmlForPost && !caps.includes('publicHtmlForPost')) {
        warn(
          `${label}: implements \`publicHtmlForPost\` but "publicHtmlForPost" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`
        )
      }
    }
  }

  // Phase 7: contentFields registry built eagerly so duplicate
  // nodeType / pattern.source registrations across plugins throw at
  // config / startup time, not on the first render that walks the
  // conflicting node.
  const contentFieldsRegistry = buildContentFieldRegistry(validPlugins)

  // AI-readable publishing: merged tiptap→markdown adapter registry.
  // Built eagerly alongside contentFieldsRegistry, and from the same
  // `validPlugins` list, so adapters from dropped plugin instances
  // (invalid instanceId) never leak in and duplicate nodeType
  // registrations throw at config / startup time.
  const markdownAdapters = buildMarkdownAdapterRegistry(validPlugins)

  // Phase 7 capability mismatch warnings — emitted once at startup,
  // alongside the existing publicHead/publicBody/schema/publicHtmlForPost
  // checks.
  for (const plugin of validPlugins) {
    const caps = plugin.capabilities
    if (!caps) continue
    const label = plugin.instanceId
      ? `${plugin.name}#${plugin.instanceId}`
      : plugin.name
    if (caps.includes('contentFields') && !plugin.contentFields) {
      warn(
        `${label}: declares capability "contentFields" but no \`contentFields\` array. Drop the capability or add the renderers.`,
      )
    }
    if (plugin.contentFields && !caps.includes('contentFields')) {
      warn(
        `${label}: implements \`contentFields\` but "contentFields" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`,
      )
    }
    if (caps.includes('publicPostScript') && !plugin.publicPostScript) {
      warn(
        `${label}: declares capability "publicPostScript" but no \`publicPostScript\` implementation. Drop the capability or add the function.`,
      )
    }
    if (plugin.publicPostScript && !caps.includes('publicPostScript')) {
      warn(
        `${label}: implements \`publicPostScript\` but "publicPostScript" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`,
      )
    }
  }

  return {
    async renderHead(): Promise<ReactNode> {
      // Gate BEFORE the S3 site-settings read — non-public requests must
      // not pay for (or trigger) a `loadSiteSettings()` fetch.
      if (!(await isPublicRequest())) return null
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return collectFor<PublicHeadDescriptor>(
        validPlugins,
        site,
        snapshot,
        (p) => p.publicHead,
        renderHeadDescriptor
      )
    },
    async renderBodyEnd(): Promise<ReactNode> {
      // Gate BEFORE the S3 site-settings read — same ordering constraint
      // as renderHead().
      if (!(await isPublicRequest())) return null
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return collectFor<PublicBodyDescriptor>(
        validPlugins,
        site,
        snapshot,
        (p) => p.publicBodyEnd,
        renderBodyDescriptor
      )
    },
    async renderBodyForPost(post: Post): Promise<ReactNode> {
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return collectForPost(validPlugins, site, snapshot, post)
    },
    async renderHtmlForPost(post: Post): Promise<PublicHtmlForPostResult> {
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return collectHtmlForPost(validPlugins, site, snapshot, post)
    },
    async renderPostScriptsForPage(posts: readonly Post[]): Promise<ReactNode> {
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return collectPostScriptsForPage(validPlugins, site, snapshot, posts)
    },
    contentFieldsRegistry,
    markdownAdapters,
    async contextForPlugins() {
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return (plugin: AmplessPlugin) =>
        makeCtx(plugin, site, snapshot)
    },
    async renderHeadForPreview(): Promise<ReactNode> {
      // Does NOT call isPublicRequest() — see PluginHeadApi.renderHeadForPreview
      // for the full rationale. Always collects all publicHead descriptors so
      // content-decoration plugins (mermaid, highlight) render in preview.
      const { snapshot, site } = await resolveRenderContext(cmsConfig, pluginSettings, siteSettings)
      return collectFor<PublicHeadDescriptor>(
        validPlugins,
        site,
        snapshot,
        (p) => p.publicHead,
        renderHeadDescriptor,
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Phase 7 — publicPostScript: page-level script dedupe + ReactNode emit
// ---------------------------------------------------------------------------

/**
 * Collect `publicPostScript` descriptors across every plugin × post on
 * the page, drop unsafe / malformed entries with dev warnings, dedupe
 * by stable `id`, and return a `<Fragment>` of `<script>` elements
 * suitable for embedding in the theme.
 *
 * Behaviour rules (locked-in by spec):
 *
 *   - `id` must be a non-empty string (dropped + warned otherwise).
 *   - `src` must pass `isSafeUrl` (http/https only; same allowlist as
 *     `publicHead` script descriptors).
 *   - Multiple posts × multiple plugins emitting the same `id`
 *     collapse to a single tag (last one wins on attribute overrides
 *     — first-arrival's id is the dedupe key).
 *   - Plugin callbacks that throw are skipped with a dev warning, not
 *     allowed to crash the whole page.
 *   - Default attributes: `async` (truthy) when neither `async` nor
 *     `defer` is supplied — matches the `publicHead` `script`
 *     descriptor default.
 */
function collectPostScriptsForPage(
  plugins: readonly AmplessPlugin[],
  site: Config['site'],
  snapshot: PluginSettingsSnapshot,
  posts: readonly Post[],
): ReactNode {
  const seen = new Set<string>()
  const elements: ReactElement[] = []
  for (const post of posts) {
    for (const plugin of plugins) {
      const factory = plugin.publicPostScript
      if (!factory) continue
      const ctx = makeCtx(plugin, site, snapshot)
      const label = `plugin "${plugin.instanceId ?? plugin.name}"`
      let descriptors: readonly PublicPostScriptDescriptor[]
      try {
        descriptors = factory.call(plugin, post, ctx) ?? []
      } catch (err) {
        warn(
          `${label}: threw inside publicPostScript callback: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        continue
      }
      for (let i = 0; i < descriptors.length; i++) {
        const d = descriptors[i]
        if (!d || typeof d !== 'object') {
          warn(`${label}: publicPostScript descriptor #${i} dropped — not an object.`)
          continue
        }
        if (typeof d.id !== 'string' || d.id.length === 0) {
          warn(
            `${label}: publicPostScript descriptor #${i} dropped — "id" must be a non-empty string.`,
          )
          continue
        }
        if (typeof d.src !== 'string' || !isSafeUrl(d.src)) {
          warn(
            `${label}: publicPostScript descriptor "${d.id}" dropped — unsafe / missing src.`,
          )
          continue
        }
        if (seen.has(d.id)) continue
        seen.add(d.id)
        const props: Record<string, unknown> = { key: d.id, src: d.src }
        const hasAsync = typeof d.async === 'boolean'
        const hasDefer = typeof d.defer === 'boolean'
        if (hasAsync) props.async = d.async
        if (hasDefer) props.defer = d.defer
        if (!hasAsync && !hasDefer) {
          props.async = true
          props.defer = true
        }
        elements.push(createElement('script', props))
      }
    }
  }
  if (elements.length === 0) return null
  return createElement(Fragment, null, ...elements)
}
