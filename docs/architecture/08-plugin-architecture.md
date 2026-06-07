> 日本語版: [08-plugin-architecture.ja.md](./08-plugin-architecture.ja.md)
> 
## 8. Plugin Architecture

> **Writing a plugin?** This page is the design spec. The hands-on
> walkthrough lives in [`packages/ampless/docs/plugin-author-guide.md`](../../packages/ampless/docs/plugin-author-guide.md)
> — the same file ships inside the `ampless` npm tarball and is
> copied into every scaffolded project at `docs/plugin-author-guide.md`.

### Trust model (v1 scope)

ampless is a customization-based CMS for engineers ([Positioning](./14-roadmap.md#positioning-2026-06-07)). Plugins are npm dependencies that the site engineer imports + configures directly (Astro integration / Next.js plugin pattern); the engineer audits each dep before installing.

The trust framework described in this section (the `trust_level` union, the IAM-scoped trusted / untrusted Lambdas, the capability declaration list, the `secretSettings` `trusted`-only check) is implemented in v1 as **first-party plugin organization**. It decides:

- Which trust tier's Lambda each event hook runs in (event-dispatcher → SQS-trusted or SQS-untrusted)
- Which IAM permissions each tier's Lambda holds (trusted reads posts + writes own S3 path; untrusted has none)
- Which features the runtime hard-gates by trust tier (e.g. `settings.secret`-declaring plugins throw at `definePlugin()` time unless `trust_level: 'trusted'`, because secret read requires the trusted Lambda's IAM permission to the `PluginSecret` table)
- Which capability declarations the runtime / admin uses for warnings, UI labels, and future allow-lists (capability mismatch is a soft warning today; admin UI labels read from capabilities; future `cms.config.ts` allow-lists may act on capabilities)
- Which output paths the runtime defensively sanitizes (e.g. `publicHtmlForPost` strict allowlist for visible HTML — same sanitize across trust tiers, defense-in-depth not trust-tier gating)

It is **not** designed as a marketplace-grade automatic sandbox that safely runs arbitrary third-party untrusted plugins the engineer has not audited. Plugins that the engineer adds to `cms.config.ts` are trusted because the engineer chose to install them, not because the framework guarantees their safety. A marketplace + runtime sandbox is a v2.0+ exploration item, not a v1.0 deliverable (see [roadmap §v2.0+ exploration](./14-roadmap.md#v20-exploration--not-committed)).

### Design Philosophy

ampless plugins run inside the same Lambda that processes events for their `trust_level` — the sandbox is **the Lambda's IAM execution role**, not a V8 isolate or `vm.Script` wrapper. There is no in-process JS sandbox: untrusted code runs in a Lambda whose IAM role has been pruned to nothing, and trusted code runs in a Lambda whose IAM role lists exactly what trusted plugins are allowed to touch. This IAM segregation is sized for first-party / engineer-audited plugins (forward-compat for an eventual marketplace, see §Trust model (v1 scope)). It does not by itself prevent a maliciously written first-party `'untrusted'` plugin from misbehaving in the ways its empty IAM role permits (e.g., consuming CPU, throwing in hooks); the engineer's audit is the last line of defense, not the framework.

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
  // mismatch. `cms.config.ts` `allowCapabilities` is a reserved future
  // allow-list surface for v2.0+ marketplace exploration (admin pages /
  // server routes / secrets / etc.); not enforced at runtime today.
  // See the `allowCapabilities` section later in this document.
  capabilities?: readonly PluginCapability[]

  // Event hooks — run in the trust_level-matched Lambda from SQS.
  // Return value is reserved: `Promise<void | PluginHookResult>`. The
  // runtime ignores it today (plugins returning `Promise<void>` keep
  // working); `PluginHookResult` is a forward-compat reservation.
  hooks?: { [K in EventType]?: (event, ctx) => Promise<void | PluginHookResult> }

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

  // Per-post visible HTML — descriptor arrays sanitized and rendered by the
  // theme's post page template at the beforeContent / afterContent slots.
  // Phase 6d (implemented). Capability: `publicHtmlForPost`.
  publicHtmlForPost?(post: Post, ctx): readonly PublicPostHtmlDescriptor[]

  // Dynamic OG image — rendered at request time via Next.js ImageResponse.
  ogImage?: OgImageConfig
}
```

`capabilities` / `instanceId` / `displayName` / `publicHead` / `publicBodyEnd` are the **Phase 1 extension** to the contract — type additions are part of the Phase 1 spec ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)). `publicBodyForPost` is the **Phase 4 extension** — per-post body injection, primarily for JSON-LD structured data. `publicHtmlForPost` is the **Phase 6d extension** — per-post visible HTML for things like reading-time badges, breadcrumbs, share links. Existing first-party plugins (`seo`, `rss`, `og-image`, `webhook`) continue to work without declaring these fields.

A plugin combines any of these surfaces. Activation is a single line in the project's `cms.config.ts`:

```typescript
plugins: [
  seoPlugin({ /* ... */ }),
  rssPlugin({ /* ... */ }),
]
```

### Capability Model

`capabilities` lists what the plugin wants to do. The runtime and admin use the list for: capability/feature-mismatch warnings, admin UI labels, and as a future allow-list surface (the runtime does not hard-gate features on `capabilities` declarations today, with limited exceptions — most notably `settings.secret` declared with `trust_level !== 'trusted'` throws at `definePlugin()` time, see the [`secretSettings`](#capability-model) row in the capability table below). This declaration surface is sized for first-party / engineer-audited plugins (see [Trust model (v1 scope)](#trust-model-v1-scope) above).

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

Phase 6d additions:

| capability | meaning | default-allowed trust_level |
|---|---|---|
| `publicHtmlForPost` | `publicHtmlForPost()` — per-post **visible HTML** at the `beforeContent` / `afterContent` slots of the theme's post page (Phase 6d, implemented). Body is sanitized by the runtime under a strict `sanitize-html` allowlist; same sanitize is applied to every trust level. | `untrusted` and up |

Phase 6a additions:

| capability | meaning | default-allowed trust_level |
|---|---|---|
| `secretSettings` | Declares one or more `settings.secret` fields — admin-editable values stored encrypted in the `PluginSecret` DDB table (IAM-only access; no Cognito group can read directly). Admin writes via `setPluginSecret` / `clearPluginSecret` AppSync mutations backed by the plugin-secret-handler Lambda, which encrypts with AES-256-GCM before writing. Trusted hooks read via `ctx.secret<T>(key)`. There are four observable behaviours at `definePlugin()` time ([plugin.ts:1004-1019](../../packages/ampless/src/plugin.ts#L1004-L1019)): (1) **`settings.secret` non-empty + `trust_level !== 'trusted'`** → `definePlugin()` throws — secret read requires the trusted Lambda's IAM permission to the `PluginSecret` table; untrusted and privileged Lambdas have no IAM read access to that table. (2) **`settings.secret` non-empty + `capabilities` declared + `'secretSettings'` missing from `capabilities`** → soft mismatch warning — matches the existing capability-mismatch pattern for `'schema'` / `'publicHtmlForPost'`. (3) **`settings.secret` non-empty + `capabilities` undefined** (legacy plugin without a `capabilities` array) → no warning — the mismatch check is skipped when `capabilities` is `undefined`, for backward compatibility. (4) **`capabilities: ['secretSettings']` declared with no `settings.secret` field** → no-op — neither warning nor throw. | `trusted` only (hard gate at `definePlugin()` time when `settings.secret` is non-empty; see the four cases above). |

Reserved capabilities (name only, implementations in later phases — see [docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md)):

`contentFields` · `adminPage` · `serverRoute` · `network` · `scheduler` · `storageWrite` · `privilegedSystem` · `cspReady`.

`cspReady` is the declarative-badge half of the CSP nonce reservation that shipped alongside `inlineScript.nonce: 'auto'` / `script.nonce: 'auto'` / `PluginPublicRenderContext.cspNonce` (Phase 1: types only, runtime no-op). Plugins can declare it today; the runtime does not cross-check or warn yet, and the planned admin-UI badge + render-time sanity check land with the middleware/SSR CSP nonce threading PR.

`allowCapabilities` is a **reserved future allow-list surface** for the `cms.config.ts` runtime. The runtime does not enforce capability allow-listing today; this entry is documented as a planned hook for the v2.0+ marketplace exploration where a site might want to declaratively allow/deny capabilities for untrusted third-party plugins. v1 first-party plugins do not need to opt-in to anything via this surface.

```typescript
plugins: [
  somePrivilegedPlugin({ ... }, { allowCapabilities: ['serverRoute', 'secretSettings'] }),
]
```

### Trust Levels

#### `untrusted`

- **IAM**: SQS consume only. Zero data permissions.
- **Runtime context**: `listPublishedPosts()` and `writePublicAsset()` both throw on call.
- **Can do**: Pure JavaScript, outbound HTTP (the Lambda has internet egress).
- **Use cases**: webhook delivery, in-process content transforms, OG-image template rendering (which runs in the public Next.js process, not the untrusted Lambda).
- **First-party examples**: `@ampless/plugin-og-image`, `@ampless/plugin-webhook`.

#### `trusted`

- **IAM**: `dynamodb:Query` / `Scan` on Post + GSIs, `dynamodb:Read` on KvStore, `dynamodb:GetItem` (read-only) on PluginSecret (Phase 6a v2; no write access — writes are exclusively via the plugin-secret-handler Lambda), `dynamodb:Write` on PostTag, `s3:PutObject` / `DeleteObject` under `public/plugins/*`, plus an exact-match grant on `public/site-settings.json` for the built-in site-settings handler.
- **Runtime context**: `listPublishedPosts()` does one Query against the `byStatus` GSI; `writePublicAsset(key, body, contentType)` writes to `public/plugins/{instanceId ?? name}/{key}`; `ctx.secret<T>(key)` reads the AES-256-GCM ciphertext from the PluginSecret table, decrypts it with the key read from `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` (injected by CDK from `amplify/secrets/encryption-key.ts`), and caches the plaintext for the invocation lifetime (per-invocation cache, compound cache key prevents cross-plugin collisions).
- **Use cases**: SEO metadata, RSS feed generation, sitemap rebuild, custom index maintenance, webhook signing with admin-rotatable secrets.
- **First-party examples**: `@ampless/plugin-seo`, `@ampless/plugin-rss`, `@ampless/plugin-webhook` (Phase 6b retrofit).

The trusted Lambda's S3 grant is bucket-wide on `public/plugins/*` rather than per-plugin. Rationale lives in `backend.ts`: trusted plugins are first-party-only (cross-plugin tampering isn't in the threat model), per-plugin enumeration breaks the IAM inline-policy size limit beyond ~50 plugins, and the runtime context namespaces keys by plugin instance so a plugin can't write to a sibling's prefix without bypassing it. The Phase 3 `writePublicAsset` formalisation keeps this split: **IAM enforces the processor-wide prefix; plugin-instance prefix enforcement stays at the runtime context layer**. The trusted processor hands each plugin a storage handle bound to `instanceId ?? name`, validates keys before writing (no absolute paths, `.` / `..` segments, backslashes, control characters, or keys over 256 characters), and warns once when a plugin declares capabilities but calls `writePublicAsset` without declaring that capability. Existing plugins with no `capabilities` field keep working without warnings. Plugin-per-Lambda with capability-based IAM is the bigger redesign on the [roadmap](./14-roadmap.md), only invoked if Phase 3 dogfood shows the runtime-layer enforcement is insufficient.

#### `privileged`

Type reserved — the contract accepts `trust_level: 'privileged'` today, but no privileged Lambda is provisioned yet. Current runtime behaviour:

- **Event hooks (`hooks`)**: both event processors (`processor-trusted` and `processor-untrusted`) silently filter out privileged plugins — hooks never execute. As of this phase, `definePlugin()` and both processors emit a `console.warn` when a privileged plugin declares `hooks` or the `'eventHooks'` capability, so the silent drop is visible at cold start, `next dev` start, and on every matching SQS event. The warning fires twice per event by design (once per processor), which itself signals that the hook is being filtered by every dispatch path.
- **Sync render surfaces** (`publicHead` / `publicBodyEnd` / `metadata` / `publicBodyForPost` / `publicHtmlForPost`): these run in the public Next.js process and are **not gated on `trust_level`** — privileged plugins that only implement sync surfaces work normally today with no warning.

**If you declare `trust_level: 'privileged'` with event hooks today, your hooks WILL NOT EXECUTE.** The type accepts it so that plugins can declare future intent; the warning serves as the signal until the privileged Lambda is provisioned.

**v2.0+ exploration only — if AmpLess later needs a plugin marketplace**: this would land as per-plugin Lambda + capabilities-based dynamic IAM if and when a marketplace requires safely running third-party plugins the engineer has not audited. The intended shape is documented below as a reference for that future exploration, not a committed v1.0 deliverable. v1 first-party plugins should declare `trust_level: 'trusted'` and stay within the trusted Lambda's existing IAM scope (Post / KvStore / PluginSecret / PostTag read + `public/plugins/*` S3 write + outbound HTTP — see the IAM scope diagram earlier in this document). Requirements outside that scope (SES, private S3 prefixes, calling external APIs that require an AWS IAM principal, etc.) are explicitly v2.0+ privileged-Lambda exploration material below; they do not fit into v1 `trusted`.

The intended future shape (for marketplace exploration reference only):

- One Lambda per privileged plugin.
- Plugin declares a capability list; CDK assembles an IAM policy from that list.
- Use cases: sending email (SES), persisting form submissions to its own table, calling external paid APIs, accessing private S3 prefixes.

### How Plugins Run

| Surface | Where it runs | When it fires |
|---|---|---|
| `hooks` | `processor-trusted` or `processor-untrusted` Lambda (per `trust_level`) | SQS message arrives — i.e. after the originating DynamoDB write. In trusted hooks, `ctx.writePublicAsset` can write only inside the plugin namespace. |
| `metadata` / `siteMetadata` | Public Next.js process (request thread) | Inside theme components / `generateMetadata()` |
| `publicHead` / `publicBodyEnd` | Public Next.js process — root layout | Site-wide render. |
| `publicBodyForPost` | Public Next.js process — theme post page template | Per-post render. Called from `pages/post.tsx` (or equivalent); `scriptType: 'application/ld+json'` required. |
| `publicHtmlForPost` | Public Next.js process — theme post page template | Per-post render. Called from `pages/post.tsx`; bodies are sanitized under a strict `sanitize-html` allowlist and embedded at the `beforeContent` / `afterContent` slots. |
| `ogImage` | Public Next.js process — typically `app/og/[slug]/route.ts` | When an OG-image URL is requested |

`hooks` is the async side of plugins. `metadata` / `siteMetadata` / `publicHead` / `publicBodyEnd` / `ogImage` are the sync side and execute inside the public site, with no AWS data permissions — they're pure or read-only over what's already passed in. None of these sync surfaces are affected by the plugin's `trust_level` IAM role; the role only governs `hooks`.

### Descriptor-based Head/Body Injection

`publicHead` and `publicBodyEnd` return **descriptor arrays**, never `ReactNode`. The descriptor whitelist is:

- `script` (external `src`, allowed `strategy`: `afterInteractive` / `lazyOnload`)
- `inlineScript` (id-required, body string; CSP nonce: API surface reserved (Phase 1 no-op). The 3-layer opt-in design is in place — `ctx.cspNonce` on `PluginPublicRenderContext` (always `undefined` today), `inlineScript.nonce: 'auto'` / `script.nonce: 'auto'` on descriptors (accepted by the type, not propagated yet), and the name-only `'cspReady'` capability (declarative badge). Runtime stamping lands with the middleware/SSR CSP nonce threading PR.)
- `meta`, `link`, `noscript`
- `iframe` (body only)

URL scheme denylist, `attrs` allowlist, and duplicate-`id` handling are enforced at validation time in the runtime layer. Returning arbitrary `ReactNode` is intentionally not offered in the safe API — that would re-open SSR-time arbitrary code execution as the implicit safety boundary, defeating the point. If a developer needs that for a project-local plugin, the future `developer.headElements` surface (Phase 6b, opt-in capability) is the planned escape hatch.

Full descriptor types and the validation contract live in [docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md).

### JSON-LD auto-escape

When an `inlineScript` descriptor carries `scriptType: 'application/ld+json'`, the runtime **automatically escapes the `body` string** before rendering — `<` → `<`, `>` → `>`, `&` → `&`, U+2028 → ` `, U+2029 → ` ` (via `escapeJsonLdInlineBody`). This applies across all three surfaces that accept `inlineScript` descriptors (`publicHead`, `publicBodyEnd`, `publicBodyForPost`). Plugin authors should return the raw JSON string; do not pre-escape it.

### `publicHtmlForPost` — per-post visible HTML

`publicHtmlForPost(post, ctx)` returns descriptors for **visible HTML** the theme embeds around the post body. v1 ships two fixed slots:

| `position` | Theme placement |
|---|---|
| `'beforeContent'` | Just before the rendered post body (`renderBody(post)`) — typical use: reading-time badge, breadcrumb, byline strip. |
| `'afterContent'` | Just after the rendered post body — typical use: share links, related-posts widget, edit-on-GitHub footer. |

The hook returns sync (`readonly PublicPostHtmlDescriptor[]`), same as `publicBodyForPost`. Themes call `await ampless.publicHtmlForPost(post)` (Promise — settings are read once per request) and embed `{html.beforeContent}` / `{html.afterContent}` directly. The runtime owns sanitize / wrapper / dedupe / namespace resolution; themes never call `dangerouslySetInnerHTML` themselves.

**Sanitizer (`sanitize-html`, strict profile).** Every descriptor body is passed through `sanitize-html` before rendering, regardless of `trust_level`. The allowlist is:

- Tags: `p` · `span` · `strong` · `em` · `a` · `code` · `br` · `ul` · `ol` · `li`
- Global attributes: `class` · `data-words` · `data-minutes` · `data-ampless-*`
- `<a>` attributes: `href` · `rel` · `target`
- URL schemes on `href`: `http` / `https` (plus relative `./path` / `../path` / `/path` / `#anchor` — schemeless URLs always pass)
- When `target="_blank"` is set, the sanitizer auto-injects `rel="noopener noreferrer"`

Explicitly rejected: `<img>` · `<iframe>` · `<video>` · `<audio>` · `<object>` · `<embed>` · `<form>` · `<style>` · inline `style` attribute · all event handlers (`on*`) · `data:` / `javascript:` / `vbscript:` / `mailto:` / `tel:` schemes. Pass-through (raw HTML) is not offered as a trust-level escape hatch in v1 — if it's ever needed it will land as a separate, explicitly-named capability.

**`id` is plugin-local.** Descriptors carry a short `id` (e.g. `'display'`) used for dedupe and React `key`. Plugin authors do not embed their own namespace in `id`; the runtime resolves it to `${instanceId ?? name}:${id}` when wrapping the entry. The validator drops descriptors whose `id` is empty, contains control characters, or exceeds 64 characters (with a dev warning).

**Dedupe is per-position.** `beforeContent` and `afterContent` each maintain an independent seen-id set, keyed by `${namespace}:${id}`. The same plugin instance returning `'display'` to both positions yields two distinct entries; two plugin instances returning `'display'` to the same position are both kept because their namespaces differ; a single plugin instance returning `'display'` twice to the same position keeps the first occurrence and warns.

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
| Admin-managed secret settings | `PluginSecret` DynamoDB table (IAM-only AppSync authorization — no direct admin/editor access). `sk` (`plugins.<instanceId>.<fieldKey>`) identifier. The `value` column stores **AES-256-GCM ciphertext** (base64; format: `IV[12] \|\| ciphertext \|\| authTag[16]`). The encryption key lives in `amplify/secrets/encryption-key.ts` (generated by `npx create-ampless setup-encryption-key`, adjacent to `amplify/backend.ts`), is imported by `defineAmplessBackend({ pluginSecretEncryptionKey })`, and injected by CDK as the `PLUGIN_SECRET_ENCRYPTION_KEY` Lambda env var — it is never stored in DynamoDB. **Threat model (Phase 6a v2.2)**: an AWS Console operator who can read the DDB table sees only ciphertext (✓ defeated). Anyone with source repo or deploy artifact access can recover the key (⚠ NOT defeated — keep repo private). A malicious trusted plugin in the same Lambda can read `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` (✗ NOT defeated — per-plugin Lambda isolation is on the roadmap). Admin write path: admin browser calls the `setPluginSecret` / `clearPluginSecret` AppSync mutations → `plugin-secret-handler` Lambda validates + reads key from env var + encrypts + writes ciphertext to DDB. The plaintext never rests in DynamoDB and never flows back to the browser. Existence check: admin browser reads from `PluginSecretIndicator` (admin/editor-accessible companion model, stores only `lastSetAt` timestamp). Hook-side read: `ctx.secret<T>(key)` in the trusted processor. Never flows to the S3 site-settings mirror. Setup: `npx create-ampless setup-encryption-key` to generate the key file; then redeploy. No SSM or AWS credentials required for key provisioning. **Dual-write integrity**: set/clear operations write to two tables in sequence; a second-write failure leaves a predictable state — set-path partial failure means the secret is functional but the indicator is absent (UI shows "not saved"); clear-path partial failure means the indicator is stale but the secret is gone (UI shows "saved" but the secret doesn't fire). | Implemented (Phase 6a + Phase 6a v2.2). Requires `trust_level: 'trusted'` + `'secretSettings'` capability. |

There is no `private/plugins/` S3 prefix and no `ampless-plugin-data` table. If a plugin needs private storage outside the above, that's part of what the privileged tier will eventually grant.

### Plugin-owned data areas

Plugin-owned data may live in the five areas listed below; the **current write paths
differ by area** and fall into three families:

- **KvStore** — admin/editor write through AppSync. Plugin hooks have no KvStore write
  helper today.
- **PluginSecret + PluginSecretIndicator** — written by the `plugin-secret-handler`
  Lambda, which is invoked by admin/editor through the `setPluginSecret` /
  `clearPluginSecret` AppSync mutations. The trusted processor reads `PluginSecret` via
  `ctx.secret<T>()` but does NOT write to either secret table.
- **S3 `public/plugins/{instanceId ?? name}/*`** — written by the trusted Lambda's hook
  context (`ctx.writePublicAsset(...)`). This is the only area a plugin hook writes to
  directly today.

Everything outside these five areas — the `Post`, `Page`, `Media`, and `PostTag`
DynamoDB tables, the `public/site-settings.json` S3 mirror, and any other plugin's
namespace — is off-limits. The runtime does not enforce this today;
it is a contract enforced by trust (and future IAM hardening).

| Area | Path / identifier | Access level | Phase |
|---|---|---|---|
| KvStore (admin settings) | DynamoDB `pk='siteconfig'`, `sk='plugins.<instanceId>.<fieldKey>'` | admin/editor via AppSync; plugin hook write helper is not provided today | Phase 2 |
| KvStore (runtime state/cache) | DynamoDB `pk='pluginstate:<plugin>:...'` with optional TTL | admin/editor via AppSync; plugin hook write helper is not provided today | Current |
| PluginSecret | DynamoDB `PluginSecret` table, `sk='plugins.<instanceId>.<fieldKey>'` | `trusted` only (IAM-only AppSync auth) | Phase 6a |
| PluginSecretIndicator | DynamoDB `PluginSecretIndicator` table, `sk='plugins.<instanceId>.<fieldKey>'` | `trusted` + admin/editor (read indicator) | Phase 6a |
| S3 plugin assets | `public/plugins/{instanceId ?? name}/*` | `trusted` only (`writePublicAsset`) | Phase 3 |

Notes:

- **Cleanup is not automatic.** When a plugin is removed from `cms.config.ts`,
  none of these five areas are cleaned up. Orphan data remains until the operator
  manually removes it. The `uninstall` lifecycle hook (see `AmplessPlugin.uninstall`
  in `packages/ampless/src/plugin.ts`) is reserved for a future lifecycle-dispatch
  PR that will add the invocation mechanism. Until that PR ships, cleanup is the
  operator's responsibility.
- **Custom DynamoDB tables.** A plugin can provision its own DynamoDB table
  outside the ampless schema (e.g. via a site-local CDK construct). If it does,
  the lifecycle management of that table — including cleanup on uninstall — is
  the plugin author's responsibility entirely. ampless has no visibility into
  external tables and the `uninstall` hook cleanup grants cover only the five
  areas above.
- **Future lifecycle-dispatch PR.** When that PR ships, the cleanup grants
  in the trusted Lambda IAM policy will be scoped to these five areas. Plugins
  that declared an empty `uninstall` body today will receive invocation events
  automatically; adding the actual cleanup body then requires a re-publish.

### Settings shape evolution (Phase 1 reservation)

`PluginSettingsManifest.version?: number` is reserved. Today the runtime does not read it; shape changes are absorbed silently, but the actual behaviour differs between `public` and `secret` fields because they travel through entirely different write/read paths:

- **`settings.public`** is read by `resolvePluginSettings` ([packages/ampless/src/plugin-settings.ts](../../packages/ampless/src/plugin-settings.ts)), which iterates `manifest.public` and falls back to `field.default` per field. Field additions resolve via `default`, deletions become orphan KvStore rows that the resolver silently skips, type changes fall through to `default` on validation failure.
- **`settings.secret`** is never read by `resolvePluginSettings`. Values are written individually through the `setPluginSecret` AppSync mutation (admin → `plugin-secret-handler` Lambda → encrypted into `PluginSecret`) and read individually by key via `ctx.secret<T>(key)` directly from `PluginSecret`. The `PluginSecretField` type forbids `default` — there is no manifest-level fallback. Field deletions leave an encrypted orphan row that no resolver walks over (operator-cleanup territory); renames orphan the old key's ciphertext and require the admin to re-enter the value under the new key; type changes only affect admin write-time validation, never the existing ciphertext on read.

The reservation exists so a future migration PR may detect manifest-vs-storage version mismatch and react to it. The exact storage location for the version, the comparison timing, and the mismatch response are all design territory for that future PR — and that PR will need to cover both the public-side resolver path and the secret-side direct-read path. Plugin authors who want to be on the future detection path can start declaring `version: 1` today.

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
| `publicHtmlForPost` declared but `publicHtmlForPost` not implemented | at startup |
| `publicHtmlForPost` implemented but `publicHtmlForPost` not declared | at startup |

### apiVersion bump policy

#### The role of apiVersion

`apiVersion` is the **load-bearing breaking-change marker** on the plugin contract. It signals "this plugin was built against a specific stable shape of the ampless plugin API". The runtime cross-checks both `package.json#amplessPlugin.apiVersion` and the value returned by `definePlugin()`'s factory, and **hard-throws on any mismatch** — including a manifest declaring a higher value than `SUPPORTED_API_VERSION`.

#### Current state

Today only `apiVersion: 1` is supported. The literal type `apiVersion: 1` on `AmplessPlugin` ([packages/ampless/src/plugin.ts](../../packages/ampless/src/plugin.ts)) accepts no other value at compile time, and `SUPPORTED_API_VERSION = 1 as const` ([packages/runtime/src/plugin-package-manifest.ts](../../packages/runtime/src/plugin-package-manifest.ts)) is the runtime gate.

```typescript
export default seoPlugin({/* config */}) // resolves to { apiVersion: 1, name: 'seo', ... }
```

#### Additive vs breaking (the line we draw)

**Additive (stays within `apiVersion: 1`)**:

- New optional fields on `AmplessPlugin` (e.g. `uninstall?`, `settings.version?`)
- New reserved capability names (e.g. `cspReady`)
- New optional fields on existing context types (e.g. `cspNonce?` on `PluginPublicRenderContext`)
- New optional fields on existing descriptors (e.g. `nonce?` on inline / external script)
- Hook return type widening that is covariant for existing implementations (e.g. `Promise<void>` → `Promise<void | PluginHookResult>`)
- Adding new reserved trust levels to the union (e.g. `'privileged'` was already in the union but treated as silent-drop before #230 made it warn-visible)
- Runtime behaviour changes that emit warnings without rejecting existing plugins (e.g. PR #230 privileged visibility)
- Adding new docs / type reservations that existing plugins are not required to declare

**Breaking (would require `apiVersion: 2`)**:

- Removing or renaming any existing required field on `AmplessPlugin`
- Adding a new required field on `AmplessPlugin` (vs optional)
- Changing the call signature of an existing hook surface (e.g. event hooks, render surfaces, lifecycle hooks)
- Changing the semantic meaning of an existing capability (vs adding a new one)
- Removing or renaming a descriptor variant
- Tightening trust_level semantics in a way that drops execution for previously-running plugins (vs the explicit-warn-then-drop visibility added in #230, which preserves the silent-drop behaviour and only adds a warning)
- Changing `PluginSettingsManifest` field shape in a way that the lenient public resolver cannot absorb and the new `version` reservation alone cannot handle

#### Phase 1–6a reservation status

All five compat-break protection PRs (#220 CSP nonce, #222 PluginHookResult, #230 privileged visibility, #232 uninstall + ownership, #234 settings.version) land **within `apiVersion: 1`**. None of them required a contract version bump because each followed the additive criteria above. Plugins that declare `apiVersion: 1` today and ignore the new reservations continue to type-check and run unchanged.

#### Beta-period policy

During beta (npm dist-tag `beta`, repo public, external plugin authors actively publishing), **`apiVersion` is held at `1`**. Individual npm package versions (`ampless@1.0.0-beta.x`, `@ampless/runtime@1.0.0-beta.x`, etc.) bump freely via changesets, but the plugin **contract** version does not bump during beta. This guarantee is independent of the npm dist-tag transition and is what plugin authors can rely on for the duration of beta.

#### Dual-version support (deferred)

Whether a future runtime supporting `apiVersion: 2` will also continue to honour `apiVersion: 1` plugins (dual-version coexistence) or will hard-cut (only `2` accepted) is a design decision **for the v2 PR itself**. This document does not commit either way. Today's `SUPPORTED_API_VERSION` is a single `as const` value; supporting multiple would mean changing it to a range or set, which is a runtime change that ships with v2.

#### Candidate triggers for a future `apiVersion: 2`

The following list is **judgment material, not a committed roadmap**. Each item is a change that, **if pursued in its current shape**, would meet the breaking criteria above. None are scheduled, none are guaranteed, and the v2 PR (whenever it lands) decides which subset actually requires the contract bump:

- **Privileged Lambda provisioning** — PR #230 added warning-only visibility for `trust_level: 'privileged'`. The actual provisioning of a privileged Lambda with its own IAM role, in a shape that changes hook execution semantics for plugins that already declared `'privileged'`, is a candidate for `apiVersion: 2`.
- **Plugin lifecycle dispatch** — PR #232 reserved `AmplessPlugin.uninstall?` and `PluginUninstallContext`. The actual lifecycle-dispatch PR (calling `uninstall` from a runtime path, adding cleanup helpers to the context) is **additive** if it lands as designed (`uninstall?` is optional, helpers are on the dedicated context). But if the design needs to extend `PluginRuntimeContext` (used by event hooks) instead, that would be a breaking change.
- **Settings shape migration mechanism** — PR #234 reserved `PluginSettingsManifest.version?`. A future `migrate` hook (or equivalent surface) is **additive** if it ships as a new optional field on `AmplessPlugin`. But if the migration mechanism requires changing how `resolvePluginSettings` returns values (e.g. exposing pre-migration values to plugin code), that would be breaking.
- **CSP nonce stamping wired through middleware** — PR #220 reserved `ctx.cspNonce`, `descriptor.nonce: 'auto'`, and `'cspReady'` capability. The actual stamping landing additively (runtime starts reading `descriptor.nonce` when `ctx.cspNonce` is populated) does NOT need v2 — that's the whole point of the reservation. But if the stamping changes which scripts are rendered (e.g. always-strip-script-when-CSP-on), that would be breaking.
- **Any change that tightens trust_level semantics** for an already-running plugin (vs adding a new tier with its own opt-in) is a v2 candidate.

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
