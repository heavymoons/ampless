> 日本語版: [08-plugin-architecture.ja.md](./08-plugin-architecture.ja.md)
> 
## 8. Plugin Architecture

> **Writing a plugin?** This page is the design spec. The hands-on
> walkthrough lives in [`packages/ampless/docs/plugin-author-guide.md`](../../packages/ampless/docs/plugin-author-guide.md)
> — the same file ships inside the `ampless` npm tarball and is
> copied into every scaffolded project at `docs/plugin-author-guide.md`.

### Design Philosophy

ampless plugins run inside the same Lambda that processes events for their `trust_level` — the sandbox is **the Lambda's IAM execution role**, not a V8 isolate or `vm.Script` wrapper. There is no in-process JS sandbox: untrusted code runs in a Lambda whose IAM role has been pruned to nothing, and trusted code runs in a Lambda whose IAM role lists exactly what trusted plugins are allowed to touch.

This trades the fine-grained capability surface of a V8-isolate sandbox for AWS-native isolation: simpler to reason about, no native-binary dependency, no `--no-node-snapshot` flag, no custom container image.

### Plugin Contract

Plugins are plain TypeScript modules that export the result of `definePlugin()` ([`packages/ampless/src/plugin.ts`](../../packages/ampless/src/plugin.ts)). The target shape:

```typescript
export interface AmplessPlugin {
  name: string
  apiVersion: 1
  trust_level: 'untrusted' | 'trusted' | 'privileged'

  // Per-install namespace. Defaults to `name`. Distinguishes multiple
  // instances of the same plugin (e.g. two GTM containers).
  instanceId?: string

  // Human-readable label for admin UI.
  displayName?: LocalizedString

  // Declared capability list. Runtime warns on declaration-vs-implementation
  // mismatch; `cms.config.ts` `allowCapabilities` gates dangerous capabilities
  // (admin pages / server routes / secrets / etc.).
  capabilities?: readonly PluginCapability[]

  // Event hooks — run in the trust_level-matched Lambda from SQS.
  hooks?: { [K in EventType]?: (event, ctx) => Promise<void> }

  // Per-post and site-level metadata — pure functions, called at request time.
  metadata?(post: Post, site): PluginMetadata
  siteMetadata?(site): PluginMetadata

  // Declarative head/body injection — descriptor arrays, not ReactNode.
  // Validated and rendered by the runtime at request time, in the public
  // Next.js process. Phase 1 (implemented — see docs/tmp/plugin-extension-spec.md).
  publicHead?(ctx): readonly PublicHeadDescriptor[]
  publicBodyEnd?(ctx): readonly PublicBodyDescriptor[]

  // Per-post body injection — descriptor arrays rendered by the theme's post
  // page template. Only `inlineScript` with `scriptType: 'application/ld+json'`
  // is accepted; other scriptType values are dropped with a warning.
  // Phase 4 (implemented). Capability: `schema`.
  publicBodyForPost?(post: Post, ctx): readonly PublicPostBodyDescriptor[]

  // Dynamic OG image — rendered at request time via Next.js ImageResponse.
  ogImage?: OgImageConfig
}
```

`capabilities` / `instanceId` / `displayName` / `publicHead` / `publicBodyEnd` are the **Phase 1 extension** to the contract — type additions are part of the Phase 1 spec ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)). `publicBodyForPost` is the **Phase 4 extension** — per-post body injection, primarily for JSON-LD structured data. Existing first-party plugins (`seo`, `rss`, `og-image`, `webhook`) continue to work without declaring these fields.

A plugin combines any of these surfaces. Activation is a single line in the project's `cms.config.ts`:

```typescript
plugins: [
  seoPlugin({ /* ... */ }),
  rssPlugin({ /* ... */ }),
]
```

### Capability Model

`capabilities` lists what the plugin wants to do. Runtime and admin use the list for validation, UI labels, and gating dangerous features.

Active capabilities (implemented):

| capability | meaning | default-allowed trust_level |
|---|---|---|
| `publicHead` | `<head>` descriptor injection (Phase 1, implemented) | `untrusted` and up |
| `publicBody` | `<body>`-end descriptor injection (Phase 1, implemented) | `untrusted` and up |
| `metadata` | existing `metadata()` / `siteMetadata()` surfaces | `untrusted` and up |
| `eventHooks` | existing async event hooks (`hooks`) | `untrusted` and up (matches the existing `@ampless/plugin-webhook`, which runs in the untrusted Lambda) |
| `writePublicAsset` | trusted hook context writes a validated, namespaced public asset (Phase 3, implemented) | `trusted` and up |

Phase 2 additions:

| capability | meaning | default-allowed trust_level |
|---|---|---|
| `adminSettings` | declares one or more `settings.public` fields editable from `/admin/plugins` (Phase 2, implemented) | `untrusted` and up |

Phase 4 additions:

| capability | meaning | default-allowed trust_level |
|---|---|---|
| `schema` | `publicBodyForPost()` — per-post body injection, primarily JSON-LD structured data; rendered by the theme's post page template (Phase 4, implemented) | `untrusted` and up |

Reserved capabilities (name only, implementations in later phases — see [docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md)):

`contentFields` · `adminPage` · `serverRoute` · `secretSettings` (Phase 6a) · `network` · `scheduler` · `storageWrite` · `privilegedSystem`.

Capabilities in the "dangerous" set (`adminPage` / `serverRoute` / `secretSettings` / `network` / `scheduler` / `storageWrite` / `privilegedSystem`) require explicit opt-in in `cms.config.ts` even when declared by the plugin package:

```typescript
plugins: [
  somePrivilegedPlugin({ ... }, { allowCapabilities: ['serverRoute', 'secretSettings'] }),
]
```

This is what prevents a casually-installed npm package from silently adding admin routes or reading secrets.

### Trust Levels

#### `untrusted`

- **IAM**: SQS consume only. Zero data permissions.
- **Runtime context**: `listPublishedPosts()` and `writePublicAsset()` both throw on call.
- **Can do**: Pure JavaScript, outbound HTTP (the Lambda has internet egress).
- **Use cases**: webhook delivery, in-process content transforms, OG-image template rendering (which runs in the public Next.js process, not the untrusted Lambda).
- **First-party examples**: `@ampless/plugin-og-image`, `@ampless/plugin-webhook`.

#### `trusted`

- **IAM**: `dynamodb:Query` / `Scan` on Post + GSIs, `dynamodb:Read` on KvStore, `dynamodb:Write` on PostTag, `s3:PutObject` / `DeleteObject` under `public/plugins/*`, plus an exact-match grant on `public/site-settings.json` for the built-in site-settings handler.
- **Runtime context**: `listPublishedPosts()` does one Query against the `byStatus` GSI; `writePublicAsset(key, body, contentType)` writes to `public/plugins/{instanceId ?? name}/{key}`.
- **Use cases**: SEO metadata, RSS feed generation, sitemap rebuild, custom index maintenance.
- **First-party examples**: `@ampless/plugin-seo`, `@ampless/plugin-rss`.

The trusted Lambda's S3 grant is bucket-wide on `public/plugins/*` rather than per-plugin. Rationale lives in `backend.ts`: trusted plugins are first-party-only (cross-plugin tampering isn't in the threat model), per-plugin enumeration breaks the IAM inline-policy size limit beyond ~50 plugins, and the runtime context namespaces keys by plugin instance so a plugin can't write to a sibling's prefix without bypassing it. The Phase 3 `writePublicAsset` formalisation keeps this split: **IAM enforces the processor-wide prefix; plugin-instance prefix enforcement stays at the runtime context layer**. The trusted processor hands each plugin a storage handle bound to `instanceId ?? name`, validates keys before writing (no absolute paths, `.` / `..` segments, backslashes, control characters, or keys over 256 characters), and warns once when a plugin declares capabilities but calls `writePublicAsset` without declaring that capability. Existing plugins with no `capabilities` field keep working without warnings. Plugin-per-Lambda with capability-based IAM is the bigger redesign on the [roadmap](./14-roadmap.md), only invoked if Phase 3 dogfood shows the runtime-layer enforcement is insufficient.

#### `privileged`

Reserved. The contract accepts `trust_level: 'privileged'` but no privileged Lambda is provisioned yet. The intended shape:

- One Lambda per privileged plugin.
- Plugin declares a capability list; CDK assembles an IAM policy from that list.
- Use cases: sending email (SES), persisting form submissions to its own table, calling external paid APIs, accessing private S3 prefixes.

This lands once the trusted/untrusted split has settled and a real privileged plugin requires it.

### How Plugins Run

| Surface | Where it runs | When it fires |
|---|---|---|
| `hooks` | `processor-trusted` or `processor-untrusted` Lambda (per `trust_level`) | SQS message arrives — i.e. after the originating DynamoDB write. In trusted hooks, `ctx.writePublicAsset` can write only inside the plugin namespace. |
| `metadata` / `siteMetadata` | Public Next.js process (request thread) | Inside theme components / `generateMetadata()` |
| `publicHead` / `publicBodyEnd` | Public Next.js process — root layout | Site-wide render. |
| `publicBodyForPost` | Public Next.js process — theme post page template | Per-post render. Called from `pages/post.tsx` (or equivalent); `scriptType: 'application/ld+json'` required. |
| `ogImage` | Public Next.js process — typically `app/og/[slug]/route.ts` | When an OG-image URL is requested |

`hooks` is the async side of plugins. `metadata` / `siteMetadata` / `publicHead` / `publicBodyEnd` / `ogImage` are the sync side and execute inside the public site, with no AWS data permissions — they're pure or read-only over what's already passed in. None of these sync surfaces are affected by the plugin's `trust_level` IAM role; the role only governs `hooks`.

### Descriptor-based Head/Body Injection

`publicHead` and `publicBodyEnd` return **descriptor arrays**, never `ReactNode`. The descriptor whitelist is:

- `script` (external `src`, allowed `strategy`: `afterInteractive` / `lazyOnload`)
- `inlineScript` (id-required, body string; CSP nonce integration is deferred to a future RFP)
- `meta`, `link`, `noscript`
- `iframe` (body only)

URL scheme denylist, `attrs` allowlist, and duplicate-`id` handling are enforced at validation time in the runtime layer. Returning arbitrary `ReactNode` is intentionally not offered in the safe API — that would re-open SSR-time arbitrary code execution as the implicit safety boundary, defeating the point. If a developer needs that for a project-local plugin, the future `developer.headElements` surface (Phase 6b, opt-in capability) is the planned escape hatch.

Full descriptor types and the validation contract live in [docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md).

### JSON-LD auto-escape

When an `inlineScript` descriptor carries `scriptType: 'application/ld+json'`, the runtime **automatically escapes the `body` string** before rendering — `<` → `<`, `>` → `>`, `&` → `&`, U+2028 → ` `, U+2029 → ` ` (via `escapeJsonLdInlineBody`). This applies across all three surfaces that accept `inlineScript` descriptors (`publicHead`, `publicBodyEnd`, `publicBodyForPost`). Plugin authors should return the raw JSON string; do not pre-escape it.

### Surface-dependent `scriptType` strictness

| Surface | `scriptType` behaviour |
|---|---|
| `publicHead` | `undefined` (default JS, backward-compatible) or `'application/ld+json'` allowed |
| `publicBodyEnd` | same as `publicHead` |
| `publicBodyForPost` | `'application/ld+json'` **required**. Descriptors with any other `scriptType` (or without one) are dropped with a console warning. Per-post arbitrary inline JS is intentionally not exposed; when that need arises it will require a new explicit capability. |

### Plugin State Storage

Plugins persist state through several mechanisms — none of them is a dedicated per-plugin DynamoDB table:

| Mechanism | Path / shape | Use | Status |
|---|---|---|---|
| `cms.config.ts` constructor args | Plugin factory arguments | Static configuration baked into the deploy | Current (Phase 1) |
| `writePublicAsset(key, body, contentType)` | S3 `public/plugins/{instanceId ?? name}/{key}` | Rendered assets the public site fetches: RSS feed, sitemap XML, JSON indexes | `trusted` only; Phase 3 formalises the capability + key validation + namespace enforcement at the runtime context level. IAM grant remains bucket-wide on `public/plugins/*` |
| `KvStore` (admin/editor-write via AppSync) | DynamoDB row `pk='pluginstate:{plugin}:...'` with optional TTL | Small state the plugin needs to read back later (counters, last-run timestamps) | Current |
| Admin-managed public settings | DynamoDB `pk='siteconfig'`, `sk='plugins.<instanceId>.<fieldKey>'`, mirrored to S3 `public/site-settings.json` | Values an admin edits from `/admin/plugins`; sync-readable from the public Next.js process via `ctx.setting<T>(key)` inside `publicHead` / `publicBodyEnd`. The runtime resolves `stored → manifest.default → undefined` per request; admin reads via `Admin.loadPluginPublicSettings(instanceId)` for the form pre-fill. Independent of `loadSiteSettings()` (which stays scoped to the curated core surface) | Implemented (Phase 2) |
| Admin-managed secret settings | TBD — `PluginSecret` admin-only AppSync model or Secrets Manager / SSM | API keys, signing secrets, etc. Never reach the public runtime | Planned (Phase 6a) |

There is no `private/plugins/` S3 prefix and no `ampless-plugin-data` table. If a plugin needs private storage outside the above, that's part of what the privileged tier will eventually grant.

### S3 Layout

```
s3://<bucket>/
  public/
    media/YYYY/MM/<epoch>-<name>          ← uploaded media
    plugins/{instanceId ?? name}/{key}    ← trusted-plugin assets (writePublicAsset)
    static/{slug}/<file>                  ← format: 'static' post bundles
    site-settings.json                    ← cached site settings
```

Everything under `public/` is reachable through the bucket policy (or the `/api/media/...` proxy for media). Plugin writes are confined to `public/plugins/{instanceId ?? name}/{key}` by the trusted runtime context.

### Existing plugin migration to Phase 3+

Trusted plugins that call `ctx.writePublicAsset()` should declare the capability:

```typescript
capabilities: ['eventHooks', 'writePublicAsset']
```

If the plugin also implements `metadata()` or `siteMetadata()`, include `metadata` as the existing metadata-surface declaration. `metadata` covers both functions; there is no separate `siteMetadata` capability.

During the migration period, legacy plugins with no `capabilities` field keep working without warnings. A plugin that does declare `capabilities` but omits `writePublicAsset` will warn once at runtime when it actually calls `ctx.writePublicAsset()`. A future major release may hard-reject that mismatch.

### Capability mismatch warnings

The runtime checks for declaration-vs-implementation mismatches at startup and warns (not errors) on:

| Mismatch | Warning trigger |
|---|---|
| `writePublicAsset` declared but `ctx.writePublicAsset()` never called | at first `writePublicAsset`-less startup |
| `writePublicAsset` not declared but `ctx.writePublicAsset()` called | at first call |
| `schema` declared but `publicBodyForPost` not implemented | at startup |
| `publicBodyForPost` implemented but `schema` not declared | at startup |

### API Versioning

Plugins declare `apiVersion: 1`. ampless rejects plugins whose version it does not understand. Today there is only one supported version, so the field is a forward-compat handle, not a load-bearing branch.

```typescript
export default seoPlugin({/* config */}) // resolves to { apiVersion: 1, name: 'seo', ... }
```

### Plugin Manifest (npm-published plugins)

Third-party plugin packages publish a normal npm tarball with their factory exported as default. The "manifest" lives in the runtime object returned by the factory call; there is no separate JSON manifest file.

### Plugin-to-plugin coupling

There is **no formal cross-plugin dependency mechanism** (no `dependsOn` field, no plugin registry lookup, no shared settings access between plugins). The current design stance is **loose coupling only** — plugins that need to interact do so through shared client-side globals (`window.dataLayer`, `window.gtag`, etc.) populated by a base plugin and read by augmenting plugins. Augmenting plugins must assume neither the order nor the presence of any base plugin and silently no-op when the global is missing — that's what makes the loose-coupling design correct without a dependency declaration. The defensive form for the GA4 event example is something like:

```js
if (Array.isArray(window.dataLayer)) {
  window.dataLayer.push({ event: 'newsletter_signup' })
}
```

A bare `window.dataLayer.push(...)` would throw when GA4 hasn't (yet) been loaded.

This matches how WordPress / Google Tag Manager extensions interoperate in practice and keeps the plugin contract simple. Formalising tight coupling (`dependsOn` for ordering, cross-plugin setting access, typed runtime bridge between plugins) is **deferred until a real first-party plugin needs it** — speculative APIs in this area would have to make non-trivial decisions about multi-instance targeting, trust-level traversal, failure modes, and cycle detection, and we don't yet have the use cases to ground those decisions.

### Consent Convention

Cookie banners in isolation are insufficient — if analytics plugins load unconditionally, they fire before the visitor has a chance to consent. The Consent Convention establishes `window.amplessConsent` as a standard cross-plugin global API and a pair of standard DOM events so that analytics plugins can gate themselves on consent without tight coupling to the banner plugin.

The reference implementation is [`@ampless/plugin-cookie-consent`](../../packages/plugin-cookie-consent/README.md).

#### API surface

```ts
interface AmplessConsentGlobal {
  /** Synchronous check — returns true if the category has been granted. */
  has(category: string): boolean
  /**
   * Has the user made an explicit decision about this category (either
   * accept or reject)? Returns true for `state[cat] === true`, true for
   * `state[cat] === false`, false only when the key is absent from
   * localStorage state. Use this — not `has` — to decide whether to
   * show the consent banner on revisit: a stored `false` is a real
   * choice, not a missing one.
   */
  isSet(category: string): boolean
  /**
   * Subscribe to the first grant of a category. The callback fires once
   * when the category is granted. If the category is already granted,
   * the callback fires immediately (one-shot semantics). Returns an
   * unsubscribe function.
   */
  on(category: string, cb: () => void): () => void
  /**
   * Internal — called by the banner UI. Updates state, persists to
   * localStorage, dispatches `ampless:consent-changed`, and fires any
   * pending `on()` callbacks if the category just became granted.
   */
  set(category: string, granted: boolean): void
}
declare global {
  interface Window { amplessConsent?: AmplessConsentGlobal }
}
```

**`has` vs `isSet` — which to use:**
- Analytics plugins that gate themselves on consent use `has` (and `on`) — they only fire when granted.
- The banner UI itself uses `isSet` to decide whether to render — a previously rejected category is a real decision and the user should not be re-prompted.

#### Standard events

Both events are dispatched on `window`:

- **`ampless:consent-ready`** — fired once by the install script immediately after `window.amplessConsent` is defined and localStorage state is restored. Analytics plugins that load before the install script listen for this event to know when `has()` / `on()` are safe to call.
- **`ampless:consent-changed`** — fired by every `set()` call. `CustomEvent` with `detail: { category: string, granted: boolean }`.

#### localStorage

The consent state is persisted under the key `'ampless:consent'` as a single-line `Record<string, boolean>` JSON string. Essential categories are always forced to `true` on every page load by the install script, overriding any stored value.

#### Analytics plugin consume pattern

Each analytics plugin that supports `consentCategory` embeds a script of the form:

```js
var initialized = false
function init() {
  if (initialized) return  // guard against double-init
  initialized = true
  // … load analytics (create script element, call gtag, etc.)
}
function wait() {
  if (window.amplessConsent.has(<CATEGORY>)) init()
  else window.amplessConsent.on(<CATEGORY>, init)
}
if (window.amplessConsent) {
  wait()
} else {
  window.addEventListener('ampless:consent-ready', wait, { once: true })
  setTimeout(function() {
    if (!window.amplessConsent) {
      console.warn('[ampless:<plugin>] consentCategory is set but window.amplessConsent never installed. Did you forget to register @ampless/plugin-cookie-consent?')
    }
  }, 5000)
}
```

The `initialized` guard prevents double-initialisation in the case where both the synchronous localStorage restore path (`has()` returns true) and the async `on()` / `ampless:consent-ready` path both trigger. The 5 s warning fires in production — this is intentional, as operator misconfiguration (missing cookie-consent registration) is worse than a spurious console line.

The fail-closed contract: if `consentCategory` is set on an analytics plugin but `window.amplessConsent` is never installed, tracking **never fires**. This is the correct fail-safe for GDPR/ePrivacy compliance.

#### Registration order

Because `ScriptStrategy` in ampless does not include `beforeInteractive`, both the consent install script and analytics plugin scripts run `afterInteractive`. Registration order in `cms.config.ts` determines script execution order — list `cookieConsentPlugin()` **before** any analytics plugin:

```ts
plugins: [
  cookieConsentPlugin(),          // installs window.amplessConsent first
  analyticsGa4Plugin({ ... }),    // reads window.amplessConsent
]
```

### Lambda Memory Configuration

| Lambda | Memory | Notes |
|---|---|---|
| `processor-untrusted` | 256 MB | Pure JS + outbound HTTP, fits comfortably. |
| `processor-trusted` | 512 MB | Headroom for built-in handlers + trusted-tier plugins running in series per SQS batch. |
| `mcp-handler` | 512 MB | Lambda Function URL with AppSync SigV4 + S3 PutObject. |

Cold start for these is ~200–400 ms on Node.js 22 — negligible for CMS workloads.

### External Network

untrusted and trusted Lambdas both have internet egress by default. The webhook plugin (untrusted) relies on it. Placing the Lambdas in a VPC private subnet to cut egress is an option but not the default — the leakage surface a plugin can reach is already only published content, so internet egress is not a meaningful exfiltration path against an honest operator.

### Not Adopted

- **`isolated-vm` / V8-isolate sandbox.** Requires `--no-node-snapshot` on Node ≥ 20, which means a container-image Lambda — worse cold starts, more maintenance, native-binary builds. IAM-based isolation is the chosen alternative.
- **`quickjs-emscripten` or similar in-process sandboxes.** Considered for a future marketplace tier, not used today.
- **Per-plugin DynamoDB tables.** Soft account limit of 2,500 tables, CDK-deploy cost per install, complex cleanup. KvStore + S3 covers what current plugins need.

---
