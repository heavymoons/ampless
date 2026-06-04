import type { AmplessEvent, EventType } from './events.js'
import type { Post, Config } from './types.js'
import type { LocalizedString } from './theme.js'

export type TrustLevel = 'untrusted' | 'trusted' | 'privileged'

/**
 * Plugin capability declarations. The runtime uses this list for
 * declaration-vs-implementation reconciliation warnings and (in later
 * phases) for `allowCapabilities` gating in `cms.config.ts`.
 *
 * Active capabilities:
 *   - `publicHead` / `publicBody`: descriptor-based head/body injection.
 *   - `metadata` / `eventHooks`: name-only declaration for existing surfaces.
 *   - `adminSettings`: admin-managed public settings manifest.
 *   - `writePublicAsset`: trusted hook context can write namespaced public assets.
 *   - `schema`: per-post body injection via `publicBodyForPost`,
 *     scoped to JSON-LD `<script type="application/ld+json">`. Themes
 *     render the descriptors by calling `ampless.publicBodyForPost(post)`
 *     in their post template.
 *   - `secretSettings`: admin-managed secret settings stored in the isolated
 *     `PluginSecret` DynamoDB model. Requires `trust_level: 'trusted'`.
 *     Trusted hooks access secrets via `ctx.secret<T>(key)`.
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
  | 'adminSettings'
  | 'writePublicAsset'
  // Phase 4 active
  | 'schema'
  // Phase 6d active
  | 'publicHtmlForPost'
  // Phase 6a active
  | 'secretSettings'
  // Reserved (name-only; later phases)
  | 'contentFields'
  | 'adminPage'
  | 'serverRoute'
  | 'network'
  | 'scheduler'
  | 'storageWrite'
  | 'privilegedSystem'
  | 'cspReady'

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
 * only the site-wide config block. Phase 2 adds the `setting()`
 * accessor for admin-managed `settings.public` values; per-route /
 * per-post context lands in Phase 4 (`plugin-per-post-rfp.md`).
 */
export interface PluginPublicRenderContext {
  site: Config['site']
  /**
   * Resolve a public setting value for the active plugin instance.
   * Returns `stored ?? manifest.default ?? undefined`. Stored values
   * are read at request time from the DDB → S3 site-settings cache
   * pipeline. Bound by the runtime when the plugin declares
   * `settings.public` — plugins without a manifest can still call
   * this, in which case it always returns `undefined`.
   *
   * The generic type is a convenience cast: the runtime does not
   * coerce values, so callers should pick `T` to match the field's
   * declared type (`text` → `string`, `number` → `number`, etc.).
   * Validation at admin save time guarantees stored values match the
   * field's declared shape, so the cast is safe in practice.
   */
  setting<T = unknown>(key: string): T | undefined
  /**
   * Request-scoped CSP nonce reservation. Always `undefined` in Phase 1
   * — the runtime does not populate this field yet. Middleware/SSR
   * threading lands with the future CSP RFP. Plugin authors who want to
   * be ready for the future stamping can declare
   * `inlineScript.nonce: 'auto'` today; once the middleware-driven
   * threading PR lands, those descriptors will become candidates for
   * runtime nonce stamping.
   */
  cspNonce?: string
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
      /**
       * Optional CSP nonce. Same semantics as inlineScript.nonce
       * (`'auto'` is the sentinel for future runtime stamping; any
       * other string is an explicit literal; undefined emits no
       * `nonce` attribute). Phase 1 reservation: runtime accepts
       * but does not propagate. See `inlineScript.nonce` JSDoc for
       * the full description.
       */
      nonce?: 'auto' | string
    }
  | {
      type: 'inlineScript'
      /** Required for duplicate detection and dev warnings. */
      id: string
      body: string
      strategy?: ScriptStrategy
      /**
       * Optional MIME-like script type. Phase 4 allows
       * `'application/ld+json'` only — when set, the runtime emits
       * `<script type="application/ld+json">` and **auto-escapes** the
       * `body` (`<`, `>`, `&`, U+2028, U+2029 → `\uXXXX`) so plugin
       * authors cannot accidentally let a value break out of the
       * script tag. This invariant is applied across all three
       * surfaces (`publicHead` / `publicBodyEnd` / `publicBodyForPost`).
       *
       * Unsupported values are dropped (descriptor and warning).
       * Surface-dependent strictness:
       *   - `publicHead` / `publicBodyEnd`: `undefined` (= default JS,
       *     backwards compatible) or `'application/ld+json'`.
       *   - `publicBodyForPost`: `'application/ld+json'` REQUIRED —
       *     the per-post body surface is scoped to JSON-LD only so
       *     the schema capability does not become a per-post arbitrary
       *     inline-JS channel. A future capability would open that
       *     explicitly.
       */
      scriptType?: 'application/ld+json'
      /**
       * Optional CSP nonce.
       *
       *   - `'auto'`: sentinel reserved for future runtime stamping.
       *     When the middleware/SSR CSP nonce threading PR lands, the
       *     runtime will read `ctx.cspNonce` from the request scope
       *     and stamp the rendered `<script>` tag automatically.
       *   - any other `string`: explicit nonce literal (advanced;
       *     rarely needed).
       *   - `undefined`: no `nonce` attribute emitted (default,
       *     backward-compatible with non-CSP sites).
       *
       * Phase 1 reservation: the runtime accepts the field but does
       * not propagate it to the rendered element. Declaring
       * `nonce: 'auto'` today is a forward-compatibility hint and
       * does not change the rendered HTML.
       *
       * Note: TypeScript does not type-widen here — `string` already
       * accepts `'auto'` as a literal. The semantic reservation is
       * documented above.
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
      /**
       * Raw HTML emitted inside `<noscript>` via React's
       * `dangerouslySetInnerHTML`. This is an intentional escape hatch:
       * descriptors otherwise constrain shape (typed props on `meta` /
       * `link` / `script`), but `<noscript>` content is often vendor-
       * supplied (analytics fallbacks, etc.) and cannot be modelled
       * as typed props without an unbounded discriminated union.
       *
       * **Trust model.** This is part of the same public injection
       * surface as `inlineScript` and `script`. It is **not** gated
       * by the plugin's `trust_level` — `untrusted` plugins can emit
       * a `noscript` descriptor too, and the runtime tests in
       * `packages/runtime/src/plugin-head.test.ts` explicitly cover
       * the untrusted case. The trust decision is **plugin install**:
       * an admin installs a plugin, accepting whatever it eventually
       * renders into `<head>` / `<body>`. The boundary is structurally
       * the same as the [editor trust
       * model](../../docs/architecture/04-access-layer-mcp.md#editor-trust-model-specification)
       * — editors can already inject arbitrary `<script>` via post
       * body anyway, so a per-plugin sandbox here wouldn't change the
       * upper bound. If a tighter sandbox is needed, scope it at
       * install time: do not install plugins you do not trust to
       * render arbitrary HTML into your pages.
       *
       * **Author guidance.** Plugin authors are still responsible
       * for the HTML being well-formed — in particular, do not embed
       * `</noscript>` sequences mid-content (such a sequence breaks
       * out of the element and the remainder of the string is parsed
       * as page-level HTML). The runtime does not detect or mask
       * this; the regression test in
       * [`packages/runtime/src/plugin-head.test.ts`](../../packages/runtime/src/plugin-head.test.ts)
       * pins the current passthrough behaviour so any future move
       * to sanitization becomes a deliberate, reviewed change.
       */
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
 * Descriptor returned by `publicBodyForPost()` (Phase 4). Limited to
 * the `inlineScript` variant with `scriptType: 'application/ld+json'`
 * REQUIRED. This narrowing is deliberate:
 *   - The per-post body surface is for JSON-LD / structured data only.
 *     We do not want the `schema` capability to become a per-post
 *     arbitrary inline-JS channel.
 *   - `meta` / `link` belong in `<head>`; theme post pages render
 *     these descriptors inside `<body>`, so meta/link are excluded.
 *
 * If a future use case needs per-post arbitrary inline JS (e.g.
 * Microsoft Clarity per-page tagging), open it through a new
 * capability such as `publicPostScript` rather than relaxing this.
 */
export type PublicPostBodyDescriptor = Extract<
  PublicHeadDescriptor,
  { type: 'inlineScript' }
> & {
  /** Required for `publicBodyForPost`; the runtime drops any descriptor
   *  whose scriptType is not 'application/ld+json'. */
  scriptType: 'application/ld+json'
}

/**
 * Slot positions for `publicHtmlForPost` descriptors. v1 ships two
 * fixed slots; additional slots (beforeTitle / sidebar / etc) are
 * deferred until dogfood reveals the need.
 */
export type PublicPostHtmlPosition = 'beforeContent' | 'afterContent'

/**
 * Per-post visible HTML descriptor returned by `publicHtmlForPost`.
 * The runtime sanitizes `body` with `sanitize-html` under a strict
 * allowlist before rendering; see the plugin-author guide for how
 * trusted plugins compose with the public surface.
 *
 * `id` is a plugin-local short identifier (e.g. `'display'`). The
 * runtime resolves it to `${instanceId ?? name}:${id}` when building
 * the React wrapper key — plugin authors do not embed their own
 * namespace in `id`.
 */
export interface PublicPostHtmlDescriptor {
  type: 'html'
  id: string
  body: string
  position: PublicPostHtmlPosition
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

/**
 * Hook return value reservation (Phase 1: type only, runtime no-op).
 *
 * Today's runtime (after-event SQS Lambdas) ignores the return value
 * entirely. The type is widened so a future PR can land additive
 * directives without breaking plugin authors who publish in the
 * meantime. Likely first use case:
 *
 *   - `metrics?: Record<string, number>` — emit observability data
 *     without touching CloudWatch SDK directly from the plugin.
 *
 * `cancel` / `post` rewrite-style directives are NOT enabled by this
 * type alone — they would also require `before:*` events to be wired
 * to plugins (currently reserved, see events.ts) and payload shapes
 * to expose mutable bodies. This PR widens the return surface only;
 * richer semantics need follow-on PRs.
 *
 * The `readonly __amplessPluginHookResult?: never` marker is a
 * type-level nominal tag: it prevents `Promise<void | PluginHookResult>`
 * from silently accepting unrelated promise types like
 * `Promise<string>` or `Promise<number>`. Plugin authors do not need
 * to set this field — it is optional and exists only to constrain
 * what the union accepts.
 */
export interface PluginHookResult {
  readonly __amplessPluginHookResult?: never
}

/**
 * Async event hook handler.
 *
 * The return value is reserved (see `PluginHookResult`). Today's
 * runtime ignores it — returning `undefined` (`Promise<void>`) is
 * the canonical "no-op" and matches existing plugin code without
 * migration. Plugins that explicitly return a `PluginHookResult`
 * object type-check today but do not change runtime behaviour
 * until the matching capability PR lands.
 *
 * Non-PluginHookResult promise types (`Promise<string>`,
 * `Promise<number>`, etc.) are rejected at compile time by the
 * `__amplessPluginHookResult` private marker on `PluginHookResult`.
 */
export type PluginEventHandler<T extends EventType = EventType> = (
  event: AmplessEvent<T>,
  ctx: PluginRuntimeContext
) => Promise<void | PluginHookResult>

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
 * Context passed to the `uninstall` lifecycle hook (Phase 1
 * reservation: runtime no-op — see `AmplessPlugin.uninstall`).
 *
 * Phase 1: structurally identical to `PluginRuntimeContext`. The
 * dedicated type exists so future cleanup helpers
 * (`deletePublicAsset`, `deletePluginSetting`, `deletePluginSecret`)
 * can be added here without exposing them to regular event hooks,
 * which take `PluginRuntimeContext` and should not be able to
 * delete state from arbitrary plugin areas.
 *
 * Phase 1 scope is limited to: (a) reserving the type name, (b)
 * reserving the hook signature `(ctx: PluginUninstallContext) =>
 * Promise<void>`. Cleanup helper methods are NOT included in
 * Phase 1 — plugin authors writing `await ctx.deletePublicAsset(...)`
 * today would hit a TS error. The actual cleanup body lands when
 * the future lifecycle-dispatch PR adds the helper methods to this
 * type (additive, no breaking change for plugins that declared an
 * empty `uninstall` body in advance).
 */
export interface PluginUninstallContext extends PluginRuntimeContext {
  // Phase 1: no additional fields. Future cleanup helpers
  // (deletePublicAsset / deletePluginSetting / deletePluginSecret)
  // land here when the lifecycle-dispatch PR ships.
}

/**
 * Extended runtime context for **trusted** hook handlers. Adds
 * `secret<T>(key)` — an async accessor that reads from the isolated
 * `PluginSecret` DynamoDB model (which admin / editor groups cannot
 * query). The result is per-invocation cached to avoid redundant DDB
 * calls when the same key is read multiple times inside one hook batch.
 *
 * Cache key is `${instanceId ?? name}:${fieldKey}` to prevent
 * cross-plugin collisions when two plugin instances declare the same
 * `key` (e.g. both have a `'signingSecret'` field).
 *
 * Only available in the trusted processor (`processor-trusted.ts`).
 * The untrusted processor never constructs a `TrustedPluginRuntimeContext`
 * — untrusted hook handlers receive plain `PluginRuntimeContext`, which
 * does not expose `secret`.
 */
export interface TrustedPluginRuntimeContext extends PluginRuntimeContext {
  /**
   * Read a secret value stored under the plugin's namespace in the
   * `PluginSecret` table. Returns `undefined` when no value has been
   * saved yet. The generic `T` is a convenience cast (same pattern as
   * `ctx.setting<T>()`) — values are always stored as strings, so `T`
   * defaults to `string`.
   *
   * Per-invocation cached: calling `ctx.secret('key')` twice within
   * the same SQS batch hit costs one DDB round-trip.
   */
  secret<T = string>(key: string): Promise<T | undefined>
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

// --- Settings manifest (Phase 2) ----------------------------------
//
// `AmplessPlugin.settings.public` declares the admin-editable fields
// a plugin instance exposes. Values are stored under
//   pk = 'siteconfig', sk = `plugins.<instanceId>.<key>`
// and surfaced to `publicHead` / `publicBodyEnd` via
// `ctx.setting<T>(key)`. See docs/architecture/08-plugin-architecture.md
// "Plugin State Storage" and packages/ampless/src/plugin-settings.ts
// for the validation / resolution helpers.

/**
 * Shared shape for every `PluginSettingField` variant. `T` is the
 * decoded value type (string for text-like fields, number for number,
 * boolean for boolean, etc.). All variants share `key` / `label` /
 * `default` / `required`; type-specific constraints (e.g. `pattern`,
 * `min`, `options`) live on the discriminated branches.
 */
interface PluginFieldBase<T> {
  /**
   * Storage key. Stored as `plugins.<instanceId>.<key>`. Must match
   * `PLUGIN_KEY_PATTERN` (`/^[a-zA-Z0-9_-]+$/`) so the `pk.sk` dotted
   * separator survives. Violations are skipped + warned by the
   * runtime/admin normalization pass.
   */
  key: string
  label: LocalizedString
  description?: LocalizedString
  /** Used by the runtime when no admin-stored value is present. */
  default?: T
  /**
   * When true, an empty / undefined value is rejected at save time
   * and the resolver returns `undefined`. When false (default),
   * string-like fields accept empty string as a valid "disabled"
   * value while non-string fields still reject empty strings.
   */
  required?: boolean
  /** Optional UI grouping (mirrors `ThemeField.group`). */
  group?: LocalizedString
}

export interface PluginTextField extends PluginFieldBase<string> {
  type: 'text'
  maxLength?: number
  /** RegExp source (e.g. `'^G-[A-Z0-9]+$'`). Validated against
   *  non-empty values; empty string skips the check. */
  pattern?: string
  /** Placeholder for the admin input. */
  placeholder?: string
}

export interface PluginTextareaField extends PluginFieldBase<string> {
  type: 'textarea'
  maxLength?: number
  placeholder?: string
  /** Rendered rows hint for the admin textarea. */
  rows?: number
}

export interface PluginBooleanField extends PluginFieldBase<boolean> {
  type: 'boolean'
}

export interface PluginNumberField extends PluginFieldBase<number> {
  type: 'number'
  min?: number
  max?: number
  step?: number
}

export interface PluginSelectField extends PluginFieldBase<string> {
  type: 'select'
  options: ReadonlyArray<{ value: string; label: LocalizedString }>
}

export interface PluginUrlField extends PluginFieldBase<string> {
  type: 'url'
  placeholder?: string
  /** When true, relative paths (`/foo`, `./foo`) pass validation; default true. */
  allowRelative?: boolean
}

export interface PluginCodeField extends PluginFieldBase<string> {
  type: 'code'
  /** Display-only language label (e.g. `'js'`, `'css'`, `'html'`). */
  language?: string
  maxLength?: number
  placeholder?: string
  rows?: number
}

export interface PluginJsonField extends PluginFieldBase<unknown> {
  type: 'json'
  placeholder?: string
  rows?: number
}

/**
 * Sub-fields allowed inside a `PluginRepeatableField`. Restricted to
 * the scalar-shape field types so the v1 admin editor can render each
 * cell with the existing `renderScalarInput` seam. Code / json /
 * repeatable are excluded — code is rarely useful per-item, json
 * recurses into "json inside json" UX that we explicitly want to
 * avoid, and nested repeatable is deferred.
 */
export type PluginRepeatableSubField =
  | PluginTextField
  | PluginTextareaField
  | PluginBooleanField
  | PluginNumberField
  | PluginSelectField
  | PluginUrlField

export interface PluginRepeatableField
  extends PluginFieldBase<ReadonlyArray<Readonly<Record<string, unknown>>>> {
  type: 'repeatable'
  /** Shape of each item — every item is a flat object keyed by sub-field `key`. */
  fields: ReadonlyArray<PluginRepeatableSubField>
  /** Hard cap on item count (default 50). Exceeding rejects the whole field. */
  maxItems?: number
  /** Minimum item count (default 0). Below rejects the whole field. */
  minItems?: number
  /** Label for the "+ Add item" button in the admin editor. */
  addLabel?: LocalizedString
  /**
   * Sub-field key used as the per-item heading in the admin editor
   * (e.g. `'id'` so categories[0] reads "analytics" not "Item 1").
   * Falls back to "Item N" when absent or empty.
   */
  itemLabelKey?: string
}

export type PluginSettingField =
  | PluginTextField
  | PluginTextareaField
  | PluginBooleanField
  | PluginNumberField
  | PluginSelectField
  | PluginUrlField
  | PluginCodeField
  | PluginJsonField
  | PluginRepeatableField

// --- Static manifest (Phase 5) -----------------------------------
//
// `PluginPackageManifest` is the shape of the optional `amplessPlugin`
// field in a plugin package's `package.json`. It lets the runtime /
// admin / tooling identify a plugin and its surface area WITHOUT
// executing the plugin's JS — useful for install-time validation, future
// admin UI that lists available npm packages, and CI checks.
//
// The runtime cross-checks this against the factory return value at
// `createPluginHead` constructor time (see `loadPackageManifest` in
// `@ampless/runtime`). Disagreement on `apiVersion` throws (breaking-
// change protection); `name` / `trustLevel` / `capabilities` mismatch
// warns.
//
// Plugins without a `packageName` (and the matching `amplessPlugin`
// field) skip the check entirely — existing plugins continue to work
// unchanged.

/**
 * Static manifest declared in a plugin package's `package.json` under
 * the `amplessPlugin` key. The plugin package must also expose
 * `package.json` itself via `exports`:
 *
 *   "exports": {
 *     ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
 *     "./package.json": "./package.json"
 *   }
 *
 * Without the subpath export, Node's package-exports gating rejects
 * `import.meta.resolve('<pkg>/package.json')` and the runtime cannot
 * load the manifest. Without `amplessPlugin`, the runtime skips
 * cross-check silently and falls back to the existing per-factory
 * capability mismatch checks (backward compatible).
 */
export interface PluginPackageManifest {
  /** Must match `AmplessPlugin.apiVersion`. Mismatch throws at runtime
   *  to prevent loading a plugin built against a different ampless API. */
  apiVersion: 1
  /** Should match `AmplessPlugin.name`. Mismatch warns. */
  name: string
  /** Should match `AmplessPlugin.trust_level`. Mismatch warns. */
  trustLevel: TrustLevel
  /** Should match `AmplessPlugin.capabilities`. Disagreement warns. */
  capabilities: readonly PluginCapability[]
  /** Optional admin UI label. */
  displayName?: LocalizedString
  /** Optional short description (1 line). */
  description?: LocalizedString
  /** Optional docs / repo URL. */
  homepage?: string
}

/**
 * Secret field types for `settings.secret`. Restricted to `text` /
 * `textarea` — the only types useful for opaque string secrets
 * (API keys, signing secrets, SMTP passwords). More complex types
 * (number, boolean, select, repeatable) are excluded: structured
 * secrets are out of scope for v1.
 *
 * The `default` property is intentionally stripped via `Omit`. If it
 * were allowed, the default value would propagate into the admin form
 * props (visible in the browser), static manifests cross-checked by
 * the runtime, and JS bundles — multiple leak paths for a value that
 * must stay server-side. Plugin authors that have a constructor-time
 * fallback value should keep it as a **closure-private variable** that
 * is never exposed in the manifest (see the plugin author guide for
 * the "closure-private fallback" pattern).
 */
export type PluginSecretField =
  | Omit<PluginTextField, 'default'>
  | Omit<PluginTextareaField, 'default'>

/**
 * Per-plugin settings declaration. Phase 2 implements `public`;
 * Phase 6a adds `secret` (admin-only storage; never reaches the public
 * runtime or S3 mirror).
 */
export interface PluginSettingsManifest {
  public?: readonly PluginSettingField[]
  /**
   * Admin-managed secret settings. Values are stored in the isolated
   * `PluginSecret` DynamoDB model, which has no `read` authorization
   * for admin / editor groups — only trusted Lambda IAM can read them.
   * Secrets never reach the public runtime or the S3 site-settings
   * mirror. Requires `trust_level: 'trusted'` and the
   * `'secretSettings'` capability. Declaring this with an untrusted
   * plugin throws at `definePlugin()` time; declaring it without the
   * capability warns.
   */
  secret?: readonly PluginSecretField[]
  /**
   * Optional manifest shape version (Phase 1 reservation: runtime
   * no-op).
   *
   * Plugin authors bump this integer when they change the shape of
   * `public` or `secret` field arrays in a way that the lenient
   * resolver cannot transparently absorb — i.e. when a field is
   * renamed, when a field's `type` changes incompatibly, or when
   * a field's semantic meaning shifts (same key + same type but the
   * value should be re-interpreted).
   *
   * **Phase 1 scope**: the field is type-only. The runtime does NOT
   * read it today, does NOT persist it next to stored values, and
   * does NOT trigger any migration. Today's lenient resolver
   * continues to apply: field additions resolve via `default`, field
   * deletions become orphan rows that `resolvePluginSettings`
   * silently skips, and incompatible type changes fall through to
   * `default` when the stored value fails validation. None of these
   * paths produce a signal to the plugin author.
   *
   * **Future migration PR**: may persist the active manifest
   * version somewhere alongside stored values and may compare it
   * to `manifest.version` at resolve time to detect mismatch. The
   * exact storage location, comparison timing, and mismatch
   * response are all design territory for that future PR — this
   * reservation fixes the field name and type on the manifest,
   * nothing more.
   *
   * Important scope distinction: this reservation covers the
   * `version` *field name and type* on `PluginSettingsManifest`
   * only. The actual migration mechanism (a `migrate` hook, an
   * admin-driven flow, batch resolve-time-rewrite, etc.) is a
   * separate design that lands with its own PR. Declaring
   * `version` today does NOT pre-wire a migration body — when the
   * future migration PR ships, plugins that want to provide a
   * migration body will need to re-publish to add it. Existing
   * plugins that omit `version` are unaffected by this addition;
   * plugins that want to participate in the future migration
   * detection path can opt in today by declaring `version: 1`,
   * instead of having to re-publish later just to add the
   * version declaration once the migration PR ships. The
   * migration body itself (and any future `migrate` hook
   * signature) is NOT reserved by this PR.
   *
   * Recommended values: positive integer, start at 1. Declare
   * `version: 1` when the manifest first gains a `version` field,
   * then bump by 1 on each shape-breaking release. Do NOT use
   * `0` / negative numbers / floats — the `number` type accepts
   * them but the semantics for those values are reserved for the
   * future migration PR (`0` may be conflated with "no version
   * declared" / legacy / pre-v1). Skip the field entirely if you
   * do not care about migration support (the default, current
   * behaviour).
   */
  version?: number
}

export interface AmplessPlugin {
  name: string
  /** Plugin API version. Currently 1; future versions will be additive. */
  apiVersion: 1
  /**
   * Optional npm package name (e.g. `'@scope/ampless-plugin-foo'` or
   * `'ampless-plugin-foo'`). When set, the runtime resolves
   * `<packageName>/package.json` at `createPluginHead` construction
   * time and cross-checks the static `amplessPlugin` manifest against
   * the factory return value (`apiVersion` mismatch throws,
   * `name` / `trustLevel` / `capabilities` mismatch warns).
   *
   * Plugins that omit this field — site-local plugins, first-party
   * plugins predating Phase 5, etc. — skip cross-check entirely and
   * fall back to the existing per-factory capability mismatch checks.
   * Backward compatible: existing plugins continue to work unchanged.
   *
   * For external `npm publish` plugins, `packageName` MUST match the
   * package's actual `name` and the package's `exports` MUST expose
   * `./package.json`. The scaffold tool (`npx create-ampless plugin`)
   * handles both automatically.
   */
  packageName?: string
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
  /**
   * Public, admin-editable settings (Phase 2). Each declared field is
   * stored under `pk='siteconfig', sk='plugins.<instanceId>.<key>'`,
   * mirrored to S3 via the trusted processor, and surfaced to
   * `publicHead` / `publicBodyEnd` via `ctx.setting<T>(key)`. Plugins
   * without an admin UI continue to work — they just don't have a
   * `settings` block.
   */
  settings?: PluginSettingsManifest
  /** Async event hooks. Run in trust_level-matched Lambda. */
  hooks?: {
    [K in EventType]?: PluginEventHandler<K>
  }
  /**
   * Lifecycle hook called when this plugin is removed from
   * `cms.config.ts` (Phase 1 reservation: runtime no-op).
   *
   * Today the runtime does not detect plugin removal and does not
   * invoke this hook — orphan data left behind by an uninstalled
   * plugin must be cleaned up manually by the operator. A future
   * lifecycle-dispatch PR will need to solve the underlying
   * problem that a plugin that has been deleted from `cms.config.ts`
   * no longer has a callable factory in memory — `Config.plugins`
   * (see `packages/ampless/src/types.ts`) only carries currently-
   * active plugin objects. Possible future approaches:
   *
   *   - Two-stage `cms.config.ts` flag — `{ plugin: myPlugin(), pendingRemoval: true }`
   *     keeps the plugin loadable while the runtime calls `uninstall`,
   *     then the operator removes the entry once cleanup succeeds.
   *   - Explicit `npx ampless uninstall <name>` CLI command — keeps
   *     the plugin imported during the call by reading the prior
   *     `cms.config.ts` entry, fires `uninstall`, then mutates the
   *     file.
   *   - Persist prior manifest + `packageName` to DDB/disk so the
   *     runtime can `await import(packageName)` to re-acquire the
   *     factory — assumes the npm package is still installed.
   *
   * The exact mechanism is deferred to the lifecycle-dispatch PR.
   * What this reservation locks in: when `uninstall` does fire,
   * it runs in a trusted-Lambda IAM context with cleanup grants for
   * the five plugin-owned data areas (see
   * docs/architecture/08-plugin-architecture.md
   * §"Plugin-owned data areas"). Idempotency is the plugin author's
   * responsibility — the hook may be invoked more than once
   * (SQS at-least-once or operator-retry).
   *
   * **Phase 1 reservation scope**: only the hook name and signature
   * are reserved. The ctx does NOT yet carry cleanup helpers
   * (`deletePublicAsset` / `deletePluginSetting` /
   * `deletePluginSecret`) — writing `await ctx.deletePublicAsset(...)`
   * today is a TS error. The recommended Phase 1 declaration is an
   * **empty body** (`async (_ctx) => {}`); the actual cleanup body
   * lands when the lifecycle-dispatch PR adds the helpers. Plugins
   * that declared the empty-body uninstall today will pick up the
   * cleanup invocation events without re-publishing for the signature
   * change, but a re-publish is required to add the actual cleanup
   * body.
   */
  uninstall?: (ctx: PluginUninstallContext) => Promise<void>
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
   * Per-post body descriptors (Phase 4). Themes render the result by
   * calling `ampless.publicBodyForPost(post)` in their post template;
   * the descriptors emit inside `<body>` (not `<head>`, which the
   * Next.js Metadata API cannot do for `<script>` tags). Primary use
   * case: JSON-LD `<script type="application/ld+json">` Article
   * schema. Restricted to inline-script descriptors with
   * `scriptType: 'application/ld+json'` — see
   * `PublicPostBodyDescriptor` for the rationale.
   *
   * The runtime auto-escapes `<`, `>`, `&`, U+2028, and U+2029 in the
   * body so plugin authors cannot accidentally let a value break out
   * of the script tag. The same escape is applied to any
   * `'application/ld+json'` descriptor returned from `publicHead` or
   * `publicBodyEnd`.
   *
   * Theme integration: first-party themes (blog / corporate / dads /
   * docs / landing / minimal) all render the result automatically.
   * Plugin authors who target custom themes should document the
   * theme-side render call in their plugin's README — when the theme
   * does not call `publicBodyForPost`, the plugin silently no-ops.
   *
   * Plugins implementing this should declare the `schema` capability.
   */
  publicBodyForPost?(
    post: Post,
    ctx: PluginPublicRenderContext,
  ): readonly PublicPostBodyDescriptor[]
  /**
   * Per-post visible HTML descriptors (Phase 6d). Themes render the
   * result by calling `ampless.publicHtmlForPost(post)` in their post
   * template; descriptors emit inside `<body>` at the `beforeContent`
   * or `afterContent` slot relative to the post prose. Primary use
   * cases: reading-time badge, breadcrumb, share links, micro-format
   * annotations.
   *
   * Each descriptor's `body` is sanitized by the runtime under a
   * strict `sanitize-html` allowlist before rendering — plugin authors
   * may NOT call `dangerouslySetInnerHTML` themselves. The runtime
   * wraps each surviving entry in a keyed `<div>` with the sanitized
   * HTML.
   *
   * Plugin-local `id` (e.g. `'display'`) is namespace-resolved to
   * `${instanceId ?? name}:${id}` by the runtime. Plugin authors do
   * not embed their own namespace in `id`.
   *
   * Plugins implementing this should declare the `'publicHtmlForPost'`
   * capability.
   */
  publicHtmlForPost?(
    post: Post,
    ctx: PluginPublicRenderContext,
  ): readonly PublicPostHtmlDescriptor[]
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
  // --- Manifest validation for settings.secret ---
  //
  // Fail-fast when a plugin declares secret fields but cannot actually
  // use them. The DDB isolation model only works when:
  //   1. The plugin runs in the trusted Lambda (trust_level === 'trusted').
  //      Untrusted Lambda has no IAM read access to PluginSecret.
  //   2. The plugin has declared the 'secretSettings' capability so that
  //      admin UI gates and future `cms.config.ts` allow-lists can act on
  //      the declaration. Missing the capability is a soft warning, not a
  //      hard error, to match the existing capability-mismatch pattern
  //      for 'schema' / 'publicHtmlForPost'.
  if (p.settings?.secret && p.settings.secret.length > 0) {
    if (p.trust_level !== 'trusted') {
      throw new Error(
        `[ampless] Plugin "${p.name}": settings.secret requires trust_level "trusted" ` +
          `but got "${p.trust_level}". Secret fields are only accessible from the trusted ` +
          `Lambda — the untrusted and privileged Lambdas have no IAM read access to the ` +
          `PluginSecret table. Either change trust_level to "trusted" or remove settings.secret.`
      )
    }
    if (p.capabilities && !p.capabilities.includes('secretSettings')) {
      console.warn(
        `[ampless] Plugin "${p.name}": settings.secret is declared but "secretSettings" is ` +
          `not in capabilities. Add "secretSettings" to capabilities so admin UI and future ` +
          `capability gates can see the declaration.`
      )
    }
  }
  if (p.trust_level === 'privileged') {
    const hasHooks =
      (p.hooks && Object.keys(p.hooks).length > 0) ||
      (p.capabilities?.includes('eventHooks') ?? false)
    if (hasHooks) {
      console.warn(
        `[ampless] Plugin "${p.name}" declares trust_level: 'privileged' with event hooks, ` +
          `but no privileged Lambda is provisioned yet. Hooks will not execute. ` +
          `Sync render surfaces (publicHead / metadata / publicBodyForPost / etc.) ` +
          `work normally regardless of trust_level. See ` +
          `docs/architecture/08-plugin-architecture.md#trust-levels for the future plan.`
      )
    }
  }
  return p
}
