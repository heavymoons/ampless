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
// Spec: docs/tmp/plugin-extension-spec.md §6.

import {
  Fragment,
  createElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  isValidPluginKey,
  resolvePluginSettings,
  type AmplessPlugin,
  type Config,
  type PluginPublicRenderContext,
  type Post,
  type PublicHeadDescriptor,
  type PublicBodyDescriptor,
  type PublicPostBodyDescriptor,
} from 'ampless'
import type { PluginSettingsApi, PluginSettingsSnapshot } from './plugin-settings.js'

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
 *   '<'      → `<`
 *   '>'      → `>`
 *   '&'      → `&`
 *   U+2028   → ` `
 *   U+2029   → ` `
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
  // `nonce` is type-only in Phase 1 (see plugin.ts comment) — we
  // intentionally do NOT forward it to the rendered element; the
  // CSP-nonce RFP will land middleware/SSR propagation later.
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
export function createPluginHead(
  cmsConfig: Config,
  pluginSettings: PluginSettingsApi
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
    }
  }

  return {
    async renderHead(): Promise<ReactNode> {
      const snapshot = await pluginSettings.loadAll()
      return collectFor<PublicHeadDescriptor>(
        validPlugins,
        cmsConfig.site,
        snapshot,
        (p) => p.publicHead,
        renderHeadDescriptor
      )
    },
    async renderBodyEnd(): Promise<ReactNode> {
      const snapshot = await pluginSettings.loadAll()
      return collectFor<PublicBodyDescriptor>(
        validPlugins,
        cmsConfig.site,
        snapshot,
        (p) => p.publicBodyEnd,
        renderBodyDescriptor
      )
    },
    async renderBodyForPost(post: Post): Promise<ReactNode> {
      const snapshot = await pluginSettings.loadAll()
      return collectForPost(validPlugins, cmsConfig.site, snapshot, post)
    },
  }
}
