<!--
  Source of truth lives in packages/ampless/docs/plugin-author-guide.md.
  Keep both copies in sync — the scaffold copy at
  templates/_shared/docs/plugin-author-guide.md must mirror this file
  byte-for-byte until we add a CI check.
-->

> 日本語版: [plugin-author-guide.ja.md](./plugin-author-guide.ja.md)

# Writing an ampless plugin

This guide walks through everything a plugin author needs to ship a
working ampless plugin, from first `definePlugin()` call to the
admin-editable settings panel and an npm publish. It covers the
Phase 1–4 surfaces — descriptor-based `<head>` / `<body>` /
per-post body injection, the async event hooks, and admin-managed
`settings.public` values.

The design rationale is in [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md);
this page is the hands-on companion.

> **Positioning**: ampless is a customization-based CMS for engineers — plugins are **npm dependencies that the site engineer imports + configures in `cms.config.ts`**. The engineer audits each dep before installing, the way they would for any other npm library (Astro integration / Next.js plugin pattern). The trust framework described in this guide (`trust_level`, capabilities, IAM-scoped Lambdas) is implemented in v1 as **first-party plugin organization** — it decides which trust tier's Lambda runs each event hook, which IAM permissions each tier holds, and applies hard runtime gates only at narrowly-scoped points (most notably: `settings.secret` requires `trust_level: 'trusted'` because secret read needs the trusted Lambda's IAM permission). Most capability declarations are soft warnings + admin labels + future allow-list surfaces, not hard runtime gates. It is **not** designed as a marketplace-grade automatic sandbox that safely runs arbitrary untrusted third-party plugins. Marketplace + runtime sandbox is a v2.0+ exploration, not a v1 guarantee. See [`docs/architecture/08-plugin-architecture.md#trust-model-v1-scope`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#trust-model-v1-scope) for the full trust model.

---

## 0. Theme vs Plugin Boundary

ampless ships both themes and plugins. Picking the right tool keeps
your code where future-you (and other site authors) will look for it.

| Want to change... | Use a theme | Use a plugin |
|---|---|---|
| Layout, typography, colour, per-route UI | ✓ | |
| Custom components on home / post / tag pages | ✓ | |
| Admin-editable settings exposed to non-developers | | ✓ (`adminSettings`) |
| Background work after content events (RSS, search index, webhooks) | | ✓ (`eventHooks`) |
| Trusted side effects (S3 writes, external API push) | | ✓ (`writePublicAsset` + `trusted`) |
| Theme-independent `<head>` / `<body>` injection (analytics, consent) | | ✓ (`publicHead` / `publicBodyEnd`) |
| Per-post machine-readable metadata (JSON-LD, etc.) | | ✓ (`schema` via `publicBodyForPost`) |
| Per-post visible HTML around the body (reading-time, breadcrumb, share) | | ✓ (`publicHtmlForPost`) |
| Code you want to share across multiple ampless sites | | ✓ (publish as npm package) |

Rule of thumb:

- Theme = **what the page looks like**. Read-only at render time.
- Plugin = **what happens beyond rendering**: admin-editable config,
  background processing, theme-agnostic injection, machine-readable
  metadata, cross-site reusability.

The two boundaries that frequently catch new authors:

- **Storage / DynamoDB / external API writes belong in a plugin**, never
  a theme. Themes only read.
- **A feature you want admins to toggle from `/admin/plugins` belongs
  in a plugin**, even if its visible effect is purely cosmetic. Themes
  carry their own settings, but those are theme-display settings, not
  site-operational ones.

Some features genuinely sit at the boundary — see [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md)
for the longer discussion.

---

## 1. What a plugin can do

ampless plugins are written in one of three places — pick the one
that matches how widely you want the code shared:

| Where | Use when | Lives in |
|---|---|---|
| **First-party** | Building on the ampless core for everyone | `packages/plugin-*/` in the ampless monorepo |
| **Site-local** | Site-specific customisation, no separate publish | `plugins/<name>/` inside your site repo |
| **External npm package** | Sharing with other sites, ready to `npm publish` | A standalone repo (`@scope/ampless-plugin-foo`) |

All three forms call the same `definePlugin({...})` factory and use the
same surfaces. The differences are packaging, distribution, and the
opt-in install-time validation that the static `package.json#amplessPlugin`
manifest enables (see §3 below).

§14 below has a one-command scaffold (`npx create-ampless@beta plugin <name>`)
that produces ready-to-use boilerplate for either of the latter two.

An ampless plugin is a TypeScript module that returns an
`AmplessPlugin` object. It plugs into one or more of the following
surfaces:

| Surface | Where | Sync / async | Phase |
|---|---|---|---|
| `metadata(post, site)` | `generateMetadata()` per post | sync | Existing |
| `siteMetadata(site)` | root layout `generateMetadata()` | sync | Existing |
| `publicHead(ctx)` | root layout `<head>` | sync (called from async layout) | 1 |
| `publicBodyEnd(ctx)` | root layout end of `<body>` | sync | 1 |
| `publicBodyForPost(post, ctx)` | theme post page template (per-post) | sync | 4 |
| `publicHtmlForPost(post, ctx)` | theme post page template (per-post, visible HTML) | sync | 6d |
| `ogImage` | `/og/[slug]` route | request-time, in public Lambda | Existing |
| `hooks` | trust_level-matched processor Lambda | async, on SQS event | Existing |
| `settings.public` | `/admin/plugins` form | declarative manifest | 2 |
| `settings.secret` | `/admin/plugins` secret section | declarative manifest, trusted Lambda only | 6a |

A few surfaces don't exist yet — they're reserved for later phases
and aren't shaped by `definePlugin` today:

- **Arbitrary `ReactNode` injection into pages.** The sync render
  surfaces (`publicHead`, `publicBodyEnd`, `publicBodyForPost`) only
  return descriptor variants. The descriptor validator is the safety
  boundary for what the runtime renders into the page; it isn't a JS
  sandbox around the plugin itself. (Plugins run as ordinary
  TypeScript in the same Node process as the rest of the site.)
- **Network inside the sync render surfaces.** The sync surfaces are
  shaped for declarative output — they don't take a Promise and there's
  no async result path, so doing `await fetch(...)` inside `publicHead`
  blocks SSR with no way to surface a deadline. Trusted Lambdas
  (`hooks`) are where the runtime expects outbound HTTP. Background
  work belongs there.
- **Admin routes / server routes / content fields.** Reserved for
  Phase 6b.

---

## 2. Minimum file layout

The fastest way to create a plugin is to scaffold one:

```bash
# Site-local (writes plugins/<name>/index.ts in the current ampless site)
npx create-ampless@beta plugin my-thing

# Standalone npm package (writes ./<name>/ ready for `npm publish`)
npx create-ampless@beta plugin @myscope/ampless-plugin-my-thing --standalone
```

§14 covers the full flow. The rest of this section explains what the
generated files mean, so you can author one by hand if you prefer.

### Site-local

```
plugins/
  my-thing/
    index.ts        # the factory; that's the whole plugin
```

The site's `package.json` / `tsconfig.json` already cover compilation —
nothing else needs to ship. Register it from `cms.config.ts` with a
relative import.

### Standalone npm package

```
ampless-plugin-my-thing/
  package.json
  tsconfig.json
  tsup.config.ts
  README.md
  CHANGELOG.md
  src/
    index.ts
    index.test.ts
```

See `packages/plugin-rss/` and `packages/plugin-analytics-ga4/` in
this repo for working first-party examples — the standalone scaffold
mirrors their layout.

The bare-minimum `src/index.ts`:

```ts
import { definePlugin, type AmplessPlugin } from 'ampless'

export default function myPlugin(): AmplessPlugin {
  return definePlugin({
    name: 'my-plugin',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    publicHead() {
      return [{ type: 'meta', name: 'x-plugin', content: 'hi' }]
    },
  })
}
```

Drop it into `cms.config.ts`:

```ts
import myPlugin from 'my-plugin'

export default defineConfig({
  site: { name: 'My Blog', url: 'https://example.com' },
  plugins: [myPlugin()],
})
```

That's it. Restart `npm run dev`, view source on any page, and the
`<meta name="x-plugin" content="hi" />` is in the rendered `<head>`.

---

## 3. The `AmplessPlugin` manifest

```ts
interface AmplessPlugin {
  name: string                      // package-like identifier, e.g. 'analytics-ga4'
  packageName?: string              // npm package name for install-time cross-check
  apiVersion: 1                     // the only valid value today
  trust_level: 'untrusted' | 'trusted' | 'privileged'
  instanceId?: string               // namespace for multi-instance installs
  displayName?: LocalizedString     // admin UI label
  capabilities?: readonly PluginCapability[]
  hooks?: { ... }                   // async events
  metadata?(post, site): PluginMetadata
  siteMetadata?(site): PluginMetadata
  publicHead?(ctx): readonly PublicHeadDescriptor[]
  publicBodyEnd?(ctx): readonly PublicBodyDescriptor[]
  publicBodyForPost?(post: Post, ctx): readonly PublicPostBodyDescriptor[]
  publicHtmlForPost?(post: Post, ctx): readonly PublicPostHtmlDescriptor[]
  ogImage?: OgImageConfig
  settings?: {
    public?: readonly PluginSettingField[]
    secret?: readonly PluginSecretField[]
    version?: number  // Phase 1 reservation; runtime ignores
  }
}
```

### `name`

A short identifier (`'analytics-ga4'`, `'rss'`, `'webhook'`). Used
as the default `instanceId` and as the trusted-processor S3 prefix
under `public/plugins/<name>/`. Must match `/^[a-zA-Z0-9_-]+$/` —
see "Naming rules" below.

### `apiVersion: 1`

There's only one version today. Future breaking-change versions will
bump this number; the runtime rejects unknown values rather than
silently mis-binding.

**Today only `apiVersion: 1` is valid.** The literal type accepts
no other value, and the runtime hard-throws if `package.json#amplessPlugin.apiVersion`
disagrees with what `definePlugin()` returns or exceeds the runtime's
`SUPPORTED_API_VERSION`.

All Phase 1 compat-break reservations (PRs #220, #222, #230, #232,
#234) live within `apiVersion: 1` — declaring or not declaring them
in your plugin does not affect the contract version.

If a future `apiVersion: 2` is ever introduced, it will be announced
through a changeset and a section update in this guide and the
architecture doc. Until then, **publish your plugin with
`apiVersion: 1` and treat it as the only valid value**. See the
[apiVersion bump policy](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#apiversion-bump-policy)
section in the architecture doc for the full criteria around what
would (and would not) trigger a v2 bump.

### `instanceId`

Optional, defaults to `name`. When you ship a plugin that can run
twice on the same site (e.g. two GA4 measurement IDs, or one
webhook endpoint per chat platform), let the host customise
`instanceId` so each install gets its own storage namespace:

```ts
analyticsGa4Plugin({ instanceId: 'marketing' })
analyticsGa4Plugin({ instanceId: 'product' })
```

Both `instanceId` and `name` must satisfy `/^[a-zA-Z0-9_-]+$/`. Dots
break the `pk='siteconfig', sk='plugins.<id>.<key>'` separator;
scopes (`@foo/bar`) and slashes are reserved.

### `displayName`

What `/admin/plugins` shows as the panel heading. A plain string is
fine for single-locale plugins; the per-locale map form
(`{ en: 'GA4', ja: 'GA4' }`) reads from the admin's active locale.

### `packageName`

Optional. When set, the runtime resolves
`<packageName>/package.json` at startup and cross-checks the static
`amplessPlugin` block there against the factory return value. This
catches install-time mistakes a plugin author would otherwise only see
at runtime (or never — capability mismatches don't crash, they just
quietly skip the surface).

For standalone plugins, set this to the npm package name your
`package.json#name` declares:

```ts
return definePlugin({
  name: 'site-verification',
  packageName: '@ishinao/ampless-plugin-site-verification',
  apiVersion: 1,
  // ...
})
```

Site-local plugins don't need it — leave it unset and the cross-check
is skipped (backward compatible, identical to plugins predating Phase
5).

### Static manifest in `package.json` (standalone plugins only)

For the cross-check to find the static manifest, two things must be
true about your published package:

1. `package.json#amplessPlugin` declares the same fields the factory
   returns:

   ```json
   "amplessPlugin": {
     "apiVersion": 1,
     "name": "site-verification",
     "trustLevel": "untrusted",
     "capabilities": ["publicHead", "adminSettings"],
     "displayName": { "en": "Site verification", "ja": "サイト所有権確認" }
   }
   ```

2. `package.json#exports` explicitly exposes `./package.json`:

   ```json
   "exports": {
     ".": {
       "import": "./dist/index.js",
       "types": "./dist/index.d.ts"
     },
     "./package.json": "./package.json"
   }
   ```

   Without this, Node's package-exports gating rejects
   `import.meta.resolve('<pkg>/package.json')` with
   `ERR_PACKAGE_PATH_NOT_EXPORTED` and the runtime silently skips the
   cross-check (your plugin still runs; you just don't get the
   install-time guard).

The `create-ampless plugin --standalone` scaffold ships both correctly.
Add a `"ampless-plugin"` entry to your `package.json#keywords` while
you're there — it's the convention used by npm searches surfacing
ampless plugins.

What the runtime checks:

| Field | Mismatch behaviour |
|---|---|
| `apiVersion` (factory vs manifest) | **Throws** at startup |
| `apiVersion` (newer than runtime supports) | **Throws** at startup |
| `name` | Warns in dev |
| `trustLevel` | Warns in dev |
| `capabilities` (set comparison) | Warns in dev |

The two `apiVersion` cases are the only failure that aborts startup —
they protect against loading a plugin built for an ampless API the
runtime can't speak. Everything else is a developer-visible warning,
not a runtime block.

---

## 4. Picking a `trust_level`

The trust tiers are implemented in v1 as **first-party plugin organization** — they decide which IAM-scoped Lambda runs your event hooks and which permissions that Lambda holds. This is a code organization surface for engineer-audited npm deps, not a marketplace-grade automatic sandbox for arbitrary third-party untrusted plugins (see the [Positioning note](#writing-an-ampless-plugin) above and the [full trust model](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#trust-model-v1-scope)).

Three tiers, picked by what the plugin needs to do **inside
event hooks** (the sync surfaces — metadata, head, body — don't
touch IAM):

| Tier | IAM | What runs today | Used by |
|---|---|---|---|
| `untrusted` | none (SQS consume only) | sync surfaces + event hooks | head/body descriptors, webhook delivery, content transforms |
| `trusted` | read posts, write `public/plugins/<instanceId ?? name>/...` | sync surfaces + event hooks | RSS feed, sitemap, computed JSON indexes |
| `privileged` | reserved (v2.0+ exploration only) | sync surfaces only — event hooks are silently filtered out (warning logged) | future marketplace exploration: SES, secrets, private S3 |

> **Warning for `privileged` plugin authors:** If you declare
> `trust_level: 'privileged'` with event `hooks` today, **your hooks
> WILL NOT EXECUTE**. Both event processors filter out privileged
> plugins and emit a `console.warn` on every matching SQS event so
> the drop is visible. Sync render surfaces (`publicHead`,
> `publicBodyEnd`, `metadata`, `publicBodyForPost`, `publicHtmlForPost`)
> work normally regardless of `trust_level` and emit no warning.
> `privileged` Lambda provisioning is a v2.0+ exploration item — if
> AmpLess later builds a plugin marketplace, that PR will automatically
> pick up plugins that already declared `'privileged'`.
> v1 first-party plugins should use `trust_level: 'trusted'` for capabilities that fit within the trusted Lambda's existing IAM scope: Post / KvStore / PluginSecret / PostTag read, `public/plugins/*` S3 write, and outbound HTTP (no AWS-IAM-authenticated calls). Requirements that fall outside that scope — SES, private S3 prefixes, calling AWS APIs that need an IAM principal of their own — are v2.0+ privileged-Lambda exploration material and don't fit into v1 `trusted`.

Rule of thumb:

- **You only need `publicHead` / `publicBodyEnd` / `metadata`** →
  `untrusted`.
- **You need to read posts from a hook (e.g. rebuild a feed on
  publish)** → `trusted`.
- **You need to call AWS APIs other than S3 PutObject on
  `public/plugins/*`** → don't ship a plugin yet; wait for the
  privileged tier or write the integration outside the plugin
  system.

A plugin running at the wrong trust level either has no permission
to do its job (silent failure inside the Lambda) or carries
permissions it didn't need. Both are fixable by switching tiers and
redeploying.

---

## 5. Sync surfaces

These run inside the **public Next.js process** (the site visitor's
request thread) and execute synchronously. They aren't designed to
do network I/O: there's no async result path, so an `await fetch(...)`
inside `publicHead` would block SSR with no deadline. Side effects
that need network calls go in `hooks` (trusted Lambdas, async).
Public-process plugin code runs with the public-page IAM role — no
elevated AWS access.

| Surface | Returns | Use case |
|---|---|---|
| `metadata(post, site)` | `PluginMetadata` (Next.js `Metadata`-shaped) | Per-post `<title>` / OGP / Twitter / canonical |
| `siteMetadata(site)` | `PluginMetadata` | Site-wide `<title>` / favicon / RSS `<link rel="alternate">` |
| `publicHead(ctx)` | `PublicHeadDescriptor[]` | Analytics loader, fonts, jsonld, hreflang |
| `publicBodyEnd(ctx)` | `PublicBodyDescriptor[]` | GTM no-script frame, chat widgets, tail snippets |
| `publicBodyForPost(post, ctx)` | `PublicPostBodyDescriptor[]` | Per-post body injection — JSON-LD structured data; rendered by the theme's post page template |
| `publicHtmlForPost(post, ctx)` | `PublicPostHtmlDescriptor[]` | Per-post visible HTML at `beforeContent` / `afterContent` — reading-time badge, breadcrumb, share links. Bodies are sanitized by the runtime under a strict `sanitize-html` allowlist |

The `ctx` object carries:

```ts
{
  site: Config['site']      // name / url / description
  setting<T>(key: string): T | undefined
}
```

`ctx.setting()` is the Phase 2 admin-managed values accessor — see
§8.

---

## 6. Descriptor reference

`publicHead` and `publicBodyEnd` return **descriptor objects**, not
`ReactNode`. The runtime validates them (URL scheme denylist, attrs
allowlist, dedup by id) and then builds the React elements itself.
This is the safety boundary for the **HTML output** a plugin can
contribute — it bounds what the runtime emits, not what the plugin's
own code does. Plugins run as ordinary TypeScript in the same Node
process as the rest of the site; the descriptor pipeline keeps the
public-page surface narrow and auditable without depending on a JS
sandbox.

### Common variants

```ts
// External script
{
  type: 'script',
  id: 'ga4-loader-analytics-ga4',
  src: 'https://www.googletagmanager.com/gtag/js?id=G-XXX',
  strategy: 'afterInteractive', // or 'lazyOnload'
  async: true,                  // optional; strategy implies it
  defer: false,
  attrs: { crossorigin: 'anonymous' },
}

// Inline script — id REQUIRED so two plugins emitting near-identical
// snippets are dedup-able
{
  type: 'inlineScript',
  id: 'ga4-init-analytics-ga4',
  body: "/* one-line bootstrap */",
  strategy: 'afterInteractive',
}

// Inline script — JSON-LD variant (valid in publicHead, publicBodyEnd, publicBodyForPost)
// The runtime auto-escapes the body; return raw JSON, not pre-escaped.
{
  type: 'inlineScript',
  id: 'schema-article',
  scriptType: 'application/ld+json',
  body: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', ... }),
}

// Meta / link / noscript
{ type: 'meta', name: 'theme-color', content: '#fff' }
{ type: 'meta', property: 'og:image', content: 'https://…' }
{ type: 'link', rel: 'preconnect', href: 'https://cdn.example.com' }
{ type: 'noscript', id: 'gtm-fallback-msg', html: '<p>JS required</p>' }
```

### Body-only variant

```ts
// iframe — for GTM no-script fallback, chat widgets, etc.
{
  type: 'iframe',
  id: 'gtm-fallback',
  src: 'https://www.googletagmanager.com/ns.html?id=GTM-XYZ',
  height: 0,
  width: 0,
  attrs: { sandbox: 'allow-scripts' },
}
```

### `PublicPostBodyDescriptor` (Phase 4)

`publicBodyForPost` returns `PublicPostBodyDescriptor[]`. This is a
restricted subset of `inlineScript` where `scriptType` is required
and must be `'application/ld+json'`:

```ts
// The only valid form for publicBodyForPost:
{
  type: 'inlineScript',
  id: 'schema-article',
  scriptType: 'application/ld+json',   // required — only value accepted
  body: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', ... }),
}
```

Why `meta` and `link` are excluded: per-post metadata is already
handled by Next.js `generateMetadata()` via the `metadata()` surface,
which integrates with the framework's deduplication and streaming
behaviour. `publicBodyForPost` exists solely for the structured data
use-case (`<script type="application/ld+json">`) that `generateMetadata`
cannot produce.

### `PublicPostHtmlDescriptor` (Phase 6d)

`publicHtmlForPost` returns `PublicPostHtmlDescriptor[]`:

```ts
{
  type: 'html',
  id: 'display',                  // plugin-local short identifier (≤ 64 chars, no control chars)
  position: 'beforeContent' | 'afterContent',
  body: '<p class="reading-time">~3 min read</p>',
}
```

The runtime sanitizes `body` with `sanitize-html` under a strict
allowlist (see the `publicHtmlForPost` example above for the full
allowlist + dropped-tag list) and wraps the result in
`<div data-ampless-plugin="${namespace}" data-ampless-position="${position}">`.
Themes embed `{html.beforeContent}` / `{html.afterContent}` in
`pages/post.tsx`; they never call `dangerouslySetInnerHTML` on plugin
output themselves.

### JSON-LD auto-escape

When `scriptType === 'application/ld+json'`, the runtime **automatically
escapes the `body` string** before rendering — `<` → `<`,
`>` → `>`, `&` → `&`, U+2028 → ` `, U+2029 → ` `.
This applies across all three surfaces that accept `inlineScript`
(`publicHead`, `publicBodyEnd`, `publicBodyForPost`). Return the raw
JSON string; do not pre-escape it.

Descriptors with an unsupported `scriptType` value are **dropped with
a console warning** and never rendered.

### Surface-dependent `scriptType` rules

| Surface | `scriptType` |
|---|---|
| `publicHead` | `undefined` (default JS) or `'application/ld+json'` |
| `publicBodyEnd` | same as `publicHead` |
| `publicBodyForPost` | `'application/ld+json'` **required**; any other value (including omitted) is dropped + warned |

### Validation rules

- **URL scheme allowlist**: `http`, `https`, or relative paths.
  `javascript:`, `data:`, `vbscript:`, `blob:`, `file:` are rejected
  before the element is rendered.
- **`attrs` allowlist**: `data-*`, `crossorigin`, `referrerpolicy`,
  `integrity`, `fetchpriority`, `loading`, `sandbox`, `allow`,
  `allowfullscreen`. Anything else is dropped with a dev warning.
- **`inlineScript.id` required**. Without it, two plugins emitting
  the same snippet can't be dedup'd, and dev warnings would point at
  index numbers no one can map back to a plugin.
- **Duplicate `id`**: the last occurrence wins. A dev warning prints
  which key was duplicated.
- **CSP nonce**: `inlineScript.nonce` and `script.nonce` are accepted
  by the type (`'auto'` is the sentinel for future runtime stamping;
  any string is an explicit literal). Phase 1 reservation: the runtime
  accepts the field but does not propagate it to the rendered element.
  See [CSP nonce (Phase 1 reservation)](#csp-nonce-phase-1-reservation)
  below.
- **Strategy**: `afterInteractive` adds `async` to external scripts.
  `lazyOnload` adds `defer`. Explicit `async` / `defer` always
  wins. `beforeInteractive` is not supported.

### What the runtime renders

For each plugin, the runtime calls `publicHead(ctx)` (resp.
`publicBodyEnd`), validates every descriptor, drops the rejects,
and wraps the survivors into a `<Fragment>`. The root layout
interpolates that fragment directly:

```tsx
<head>{pluginHead}</head>
{/* … */}
<body>… {pluginBodyEnd}</body>
```

`cms.config.plugins` iteration order is preserved across the
collected list.

> **When are `publicHead` / `publicBodyEnd` rendered?**
> The runtime renders output from these surfaces only on public requests
> that have been processed by the ampless middleware. They are **not**
> rendered under `/admin`, `/login`, or on theme-preview requests
> (`?previewTheme=` / `?previewColorScheme=` iframe). This prevents GTM,
> GA, and consent scripts from polluting analytics with admin page views
> or live-preview traffic. An npm update to `@ampless/runtime` is
> sufficient to pick up this behaviour — no changes to site code are
> required.

### `publicBodyForPost` example (Phase 4)

Declare the `schema` capability and implement the surface:

```typescript
import { definePlugin } from 'ampless'

export default function schemaJsonldPlugin() {
  return definePlugin({
    name: 'schema-jsonld',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['schema'],
    publicBodyForPost(post, ctx) {
      return [{
        type: 'inlineScript',
        id: 'schema-article',
        scriptType: 'application/ld+json',
        body: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.title,
          url: `${ctx.site.url}/${post.slug}`,
          datePublished: post.publishedAt,
        }),
      }]
    },
  })
}
```

The theme's `pages/post.tsx` calls `ampless.publicBodyForPost(post)`
and renders the returned descriptors. The runtime inserts a
`<script type="application/ld+json">` element with the auto-escaped
body into the page.

### `publicHtmlForPost` example (Phase 6d)

Use `publicHtmlForPost` when you need to render **visible HTML**
around a post — reading-time badge, breadcrumb, share links,
micro-format annotations, etc. The runtime sanitizes the body before
rendering and embeds the result at the `beforeContent` or
`afterContent` slot, so themes never call `dangerouslySetInnerHTML`
on plugin output.

```typescript
import { definePlugin } from 'ampless'

export default function readingTimePlugin() {
  return definePlugin({
    name: 'reading-time',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHtmlForPost'],
    publicHtmlForPost(post, _ctx) {
      const words = countWords(post)
      const minutes = Math.max(1, Math.round(words / 200))
      return [{
        type: 'html',
        id: 'display',
        position: 'beforeContent',
        body: `<p class="reading-time" data-words="${words}" data-minutes="${minutes}">~${minutes} min read</p>`,
      }]
    },
  })
}
```

The theme's `pages/post.tsx` calls
`const html = await ampless.publicHtmlForPost(post)` once and embeds
the slots:

```tsx
{postBody}            {/* publicBodyForPost — JSON-LD */}
{html.beforeContent}  {/* publicHtmlForPost — beforeContent slot */}
<div className="prose">{await ampless.renderBody(post)}</div>
{html.afterContent}   {/* publicHtmlForPost — afterContent slot */}
```

**Slot positions** (v1): `'beforeContent'` and `'afterContent'`.

**Sanitizer (strict, identical across trust levels):**

- Allowed tags: `p` · `span` · `strong` · `em` · `a` · `code` · `br` · `ul` · `ol` · `li`
- Allowed global attributes: `class` · `data-words` · `data-minutes` · `data-ampless-*`
- Allowed `<a>` attributes: `href` · `rel` · `target`. `target="_blank"` triggers auto-injection of `rel="noopener noreferrer"`.
- Allowed URL schemes on `href`: `http` / `https`. Relative URLs (`./path`, `../path`, `/path`, `#anchor`) pass through. `javascript:` / `data:` / `mailto:` / `tel:` / `vbscript:` are dropped.
- Dropped tags / attributes: `<img>` · `<iframe>` · `<video>` · `<audio>` · `<object>` · `<embed>` · `<form>` · `<style>` · inline `style` · all event handlers (`on*`).

If you need a tag outside this list, open an issue — the allowlist
expands by design, not by escape hatch.

**`id` is plugin-local.** Use a short identifier (e.g. `'display'`).
The runtime resolves it to `${instanceId ?? name}:${id}` when building
the React `key` and the wrapper `<div>`'s `data-ampless-plugin` /
`data-ampless-position` attributes. Do not embed your own namespace
in `id`. The validator drops descriptors whose `id` is empty,
contains control characters, or exceeds 64 characters.

**Dedupe is per-position.** Returning the same `id` to both
`beforeContent` and `afterContent` from a single plugin instance is
fine — they live in independent dedupe scopes. Returning the same
`id` twice to the same position keeps only the first occurrence and
warns.

**Multiple instances.** Two `reading-time` plugin instances with
distinct `instanceId` (e.g. `reading-time-en` / `reading-time-jp`)
can both emit `id: 'display'` to the same position; the runtime
keeps both because the namespaces differ.

### Client-side DOM mutation: don't

Inline scripts you return from `publicHead` or `publicBodyEnd` execute
during HTML parsing, before React hydrates the page. **They must not
mutate visible DOM inside a React-managed subtree** — when hydration
runs, React sees a tree that doesn't match its virtual DOM, throws a
`Hydration failed because the server rendered HTML didn't match the
client` error, and regenerates the subtree from scratch. Your inserted
nodes get wiped.

React 19 additionally refuses to execute `<script>` tags it
encounters while rendering a client component, so a script that did
something like `document.body.append(myNewElement)` may not even fire.

**Safe patterns**:

- **Global state / non-DOM side effects**: push to `window.dataLayer`,
  set a config object, instantiate an analytics SDK. This is what
  `@ampless/plugin-analytics-ga4`, `@ampless/plugin-gtm`, and
  `@ampless/plugin-plausible` do.
- **External widget loaders**: load a third-party script that manages
  its own isolated container (Crisp, Intercom, Drift). The widget's
  shadow DOM / fixed-position overlay lives outside React's tree and
  doesn't conflict with hydration.
- **SSR-only descriptors**: return `meta` / `link` / `noscript` (and,
  on `publicBodyEnd`, `iframe`) — the runtime renders these
  server-side and they're part of React's virtual DOM from the start.

**Patterns to avoid**:

- `document.createElement('div')` + `document.body.append(...)`
- Modifying classes / attributes / text content of elements rendered
  by the theme
- Inserting per-post HTML by reading something like `#post-body`
  client-side — there's no `publicHead`-for-post analogue today, and
  any client-side rewrite of a server-rendered subtree races against
  hydration

For visible per-post output, use `publicHtmlForPost` (Phase 6d — see
the example above and §6's `PublicPostHtmlDescriptor`). The runtime
emits server-side HTML at fixed slots around the post body, so
nothing races against hydration.

---

## 6a. Scheduled posts and content events

ampless supports **scheduled publishing**: a post with `status:
'published'` and a future `publishedAt` is hidden from all public
reads until that time. Once `publishedAt` arrives, the post becomes
visible within the site's natural cache window (≤ ~5 minutes by
default) — there is no exact-time trigger.

### Events fire at save time, not at `publishedAt`

`content.published` (and `content.updated`) are emitted via DynamoDB
Streams **when the post is saved**, not when `publishedAt` arrives.
This means a plugin that reacts to `content.published` will run
**before the post is publicly visible** when the post is future-dated.

For trusted plugins that rebuild public assets from the current post
list (RSS, sitemap, JSON indexes), this is harmless — `listPublishedPosts()`
already filters out future-dated posts, so the regenerated asset
simply omits the scheduled post until it goes live.

For **outbound-notification plugins** (webhook, push notification,
social post) the early fire matters: the notification will be
delivered to subscribers while the post URL still returns 404 or
redirects to the home page.

### Recommended pattern: gate on `publishedAt`

Check `event.payload.publishedAt` before dispatching. Skip or defer
when the post is future-dated:

```ts
hooks: {
  async 'content.published'(event, ctx) {
    const { publishedAt } = event.payload

    // Skip notification for future-scheduled posts. The event fires
    // at save time, but the post won't be public until publishedAt.
    if (publishedAt && new Date(publishedAt) > new Date()) {
      return
    }

    // Post is live now — safe to notify.
    await sendWebhook(event.payload, ctx)
  },
}
```

The `publishedAt` value in the event payload is a UTC ISO 8601 string
(`...Z`). Parse it with `new Date()` or your preferred date library
before comparing against `Date.now()`.

### Future work

Aligning event emission with the scheduled time — so `content.published`
fires at `publishedAt` rather than at save time — is a planned
enhancement. It requires a scheduler component (EventBridge Scheduler
or a DynamoDB TTL-triggered Lambda) and is not yet in scope for the
current release. Until then, the pattern above is the recommended
guard for notification plugins.

For a full description of `publishedAt` semantics from the operator's
perspective, see [`docs/scheduled-publishing.md`](https://github.com/heavymoons/ampless/blob/main/docs/scheduled-publishing.md).

---

### CSP nonce (Phase 1 reservation)

Content Security Policy (CSP) is a near-mandatory requirement for production
sites. To avoid breaking every plugin at once when nonce propagation lands,
ampless reserves the API surface today (Phase 1 no-op) so plugins can opt in
ahead of time.

The 3-layer design:

1. **`ctx.cspNonce?: string`** on `PluginPublicRenderContext` — type-reserved
   on the interface; always `undefined` today. The runtime does not populate
   this field yet; reads resolve to `undefined`. Middleware/SSR nonce threading
   lands with the future CSP RFP.

2. **`descriptor.nonce: 'auto' | string`** — accepted by the type on both
   `inlineScript` and `script` descriptor variants. `'auto'` is the sentinel
   for future runtime stamping; any other string is an explicit literal;
   `undefined` emits no `nonce` attribute (default, backward-compatible).
   Phase 1: the runtime accepts but does not propagate it. Declaring
   `nonce: 'auto'` today is a forward-compatibility hint and does not change
   the rendered HTML.

3. **`'cspReady'` capability** — a name-only declarative badge. Declaring it
   signals intent; future admin UI / sanity checks may surface it. No runtime
   cross-check or enforcement exists in Phase 1.

**How to be ready:**

```ts
// src/index.ts
definePlugin({
  name: 'my-plugin',
  apiVersion: 1,
  trust_level: 'untrusted',
  capabilities: ['publicHead', 'cspReady'],
  publicHead: () => [{
    type: 'inlineScript',
    id: 'my-snippet',
    body: '...',
    nonce: 'auto',    // forward-compat hint; no effect in Phase 1
  }],
})
```

For standalone npm-published plugins, also update `package.json#amplessPlugin.capabilities`
to match — the runtime cross-check warns on disagreement between the static
manifest and the factory return value:

```json
{
  "amplessPlugin": {
    "apiVersion": 1,
    "name": "my-plugin",
    "trustLevel": "untrusted",
    "capabilities": ["publicHead", "cspReady"]
  }
}
```

**What "cspReady" means:**

- Site-level CSP compliance depends on middleware / response headers / other
  inline content the runtime does not control.
- Once the middleware-driven nonce threading PR lands, plugin-supplied scripts
  that carry `nonce: 'auto'` will become candidates for runtime nonce stamping.
- `'cspReady'` does **not** appear in `create-ampless plugin --capabilities`
  output — it is a reserved capability and the scaffold excludes it to avoid
  implying active enforcement.

---

## 6b. In-body content renderers: `contentFields` (Phase 7)

The `contentFields` capability lets a plugin replace specific fragments
of a post body — tiptap nodes or single-line markdown URLs — with a
React subtree it controls. Used by the first-party `@ampless/plugin-youtube`
and `@ampless/plugin-x-embed` packages to expand `https://youtu.be/...`
URLs into iframe players and `https://x.com/<handle>/status/...` URLs
into tweet blockquotes.

### Shape

```ts
import { definePlugin, type ContentFieldRenderer } from 'ampless'

definePlugin({
  // ...
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'amplessYoutube',
      render: (node, ctx) => <YouTubeEmbed videoId={String(node.attrs?.videoId)} />,
    },
    {
      kind: 'markdown-url',
      pattern: /^https:\/\/youtu\.be\/([\w-]{11})$/,
      render: ({ match }, ctx) => <YouTubeEmbed videoId={match[1]!} />,
    },
  ],
})
```

Each renderer is called server-side by the runtime when it walks a post
body during `ampless.renderBody(post)`. The return value must be a
`ReactNode`. The plugin's `PluginPublicRenderContext` (`ctx`) is the
same context handed to `publicHead` / `publicBodyEnd`, so `ctx.setting<T>(key)`
works exactly the same way.

### The two kinds

- **`tiptap`** — keyed by `nodeType` (a string, e.g. `'amplessYoutube'`).
  The runtime's tiptap walker calls the renderer whenever it encounters
  a node whose `type` matches `nodeType`. Default switch-case rendering
  is bypassed; the plugin owns the subtree.
- **`markdown-url`** — keyed by an anchored `RegExp` (`^...$`). The
  runtime tokenizes markdown with `marked.lexer` and, for any
  `paragraph` token whose entire content is a single URL (autolink,
  bare URL, or `[text](url)` markdown link), tests the URL against
  each registered pattern. The first match wins; capture groups are
  exposed via `match[1]`, `match[2]`, etc.

### Naming and uniqueness

- First-party plugins use the `ampless...` camelCase prefix
  (`amplessYoutube`, `amplessTweet`) so the namespace stays clear of
  community-contributed `nodeType`s.
- The runtime rejects duplicate `nodeType` / `pattern.source` at
  startup with a thrown error. The first plugin to register a given key
  wins; the second one fails fast. Multi-instance v1 is not supported.

### Markdown URL pattern rules

- **Always anchor with `^...$`** so the pattern only matches paragraphs
  whose entire content is a single URL. A pattern without anchors would
  match URLs embedded mid-paragraph and break the surrounding text.
- The runtime trims leading/trailing whitespace before matching, so
  patterns don't need to account for `\s*` around the URL.
- Inline `[caption](url)` markdown links are accepted when the link is
  the paragraph's only token. `[caption with link](url)` mixed with
  surrounding text is NOT matched (correct behaviour: the prose
  belongs in the post, not a video embed).

---

## 6c. Page-level scripts: `publicPostScript` (Phase 7)

The `publicPostScript` capability lets a plugin emit a `<script>` tag
that any post on the page needs. The runtime dedupes by stable `id`
so multiple embeds in one or several posts collapse to one script tag.
Used by `@ampless/plugin-x-embed` to inject
`https://platform.twitter.com/widgets.js` once per page that has any
tweet embed.

### Shape

```ts
definePlugin({
  capabilities: ['contentFields', 'publicPostScript'],
  publicPostScript(post, ctx) {
    if (!hasTweetIn(post)) return []
    return [
      {
        id: 'amplessTweet:widgets',
        src: 'https://platform.twitter.com/widgets.js',
        async: true,
      },
    ]
  },
})
```

### Theme integration

Themes call `{await ampless.publicPostScriptsForPage(posts)}` after
rendering each post body. First-party themes do this automatically in
their post detail page and home page (when a featured post is shown):

```tsx
<div>{await ampless.renderBody(post)}</div>
{await ampless.publicPostScriptsForPage([post])}
```

The runtime:

1. Calls `publicPostScript(post, ctx)` for each plugin × post pair.
2. Drops descriptors with empty/non-string `id`, with `src` that fails
   the http(s) allowlist, or that aren't objects.
3. Dedupes by `id` (first arrival wins).
4. Emits a `<Fragment>` of `<script src={src} async defer />` elements.

### CSP considerations

The runtime does **not** enforce a host allowlist on `src`. CSP is the
site engineer's responsibility — add the script host (e.g.
`platform.twitter.com`) to `script-src` in `next.config.ts` /
middleware. This is documented in each plugin's README.

---

## 6d. Admin editor extension wiring (Phase 7)

Plugins that contribute tiptap Node extensions to the admin editor
ship a separate client-side entry under the `./editor` subpath.
`app/(admin)/admin/_editor-bootstrap.tsx` is **auto-generated** by
`npm run update-ampless` — you should not edit it by hand.

### For plugin authors

Declare `editorExports` in `package.json#amplessPlugin`:

```jsonc
// packages/plugin-youtube/package.json
"amplessPlugin": {
  "apiVersion": 1,
  "name": "youtube",
  "trustLevel": "trusted",
  "capabilities": ["contentFields"],
  "editorExports": "./editor"   // ← subpath where the editor module lives
}
```

Export `editorExtension` as a named symbol from that subpath:

```ts
// packages/plugin-youtube/src/editor.tsx
export const editorExtension = AmplessYoutubeNode   // tiptap Node or Extension
```

The subpath must be declared in `package.json#exports` as well (the
codegen validates this — a missing `exports` entry triggers a warning
and the plugin is skipped):

```jsonc
"exports": {
  ".":       { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
  "./editor": { "import": "./dist/editor.js", "types": "./dist/editor.d.ts" }
}
```

### For plugin users (site engineers)

1. `npm i @ampless/plugin-youtube@beta` — add the plugin as a dependency.
2. Register it in `cms.config.ts` for the server-side renderer.
3. `npm run update-ampless` — regenerates `_editor-bootstrap.tsx`
   automatically from the installed plugin manifests.

The generated file is committed to your repo and looks like:

```tsx
// app/(admin)/admin/_editor-bootstrap.tsx  (AUTO-GENERATED — do not edit)
'use client'
// AUTO-GENERATED by `npm run update-ampless`. Do not edit — your changes
// will be overwritten on the next run.
import { installAdminEditorExtensions } from '@ampless/admin/editor'
import { editorExtension as __ampless_plugin_x_embed_editor } from '@ampless/plugin-x-embed/editor'
import { editorExtension as __ampless_plugin_youtube_editor } from '@ampless/plugin-youtube/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([
    __ampless_plugin_x_embed_editor,
    __ampless_plugin_youtube_editor,
  ])
  return <>{children}</>
}
```

The file is then wired into the admin layout (already in the template — no
extra work required):

```tsx
// templates/_shared/app/(admin)/admin/layout.tsx
import { createAdminLayout } from '@ampless/admin/pages'
import { EditorBootstrap } from './_editor-bootstrap'
export default createAdminLayout(admin, { editorBootstrap: EditorBootstrap })
```

`installAdminEditorExtensions` is idempotent and runs at render time
inside a client component. The admin's `<TiptapEditor>` spreads the
registered list onto its built-in extensions on every render.

The `_editor-bootstrap.tsx` generated by `update-ampless` wires three
install calls — extensions, markdown adapters, and html adapters:

```tsx
// app/(admin)/admin/_editor-bootstrap.tsx  (AUTO-GENERATED — do not edit)
'use client'
// AUTO-GENERATED by `npm run update-ampless`. Do not edit ...
import { installAdminEditorExtensions, installAdminTiptapNodeMarkdown, installAdminTiptapNodeHtml } from '@ampless/admin/editor'
import * as __ampless_plugin_x_embed_editor from '@ampless/plugin-x-embed/editor'
import * as __ampless_plugin_youtube_editor from '@ampless/plugin-youtube/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([
    __ampless_plugin_x_embed_editor.editorExtension,
    __ampless_plugin_youtube_editor.editorExtension,
  ])
  installAdminTiptapNodeMarkdown([
    __ampless_plugin_x_embed_editor.tiptapNodeToMarkdown ?? {},
    __ampless_plugin_youtube_editor.tiptapNodeToMarkdown ?? {},
  ])
  installAdminTiptapNodeHtml([
    __ampless_plugin_x_embed_editor.tiptapNodeToHtml ?? {},
    __ampless_plugin_youtube_editor.tiptapNodeToHtml ?? {},
  ])
  return <>{children}</>
}
```

### Lossless format-switch adapters (`tiptapNodeToMarkdown` + `tiptapNodeToHtml`)

When the operator switches the post format in the admin UI (e.g. `tiptap →
markdown` or `tiptap → html`), the admin must convert the body content. For
standard prose nodes tiptap's built-in renderers handle this, but **atom
nodes** (embed blocks like `amplessYoutube`) have no children — they fall
through with empty output, silently dropping the embed.

Two adapters fix both directions:

| Adapter               | Direction                         | Output |
| --------------------- | --------------------------------- | ------ |
| `tiptapNodeToMarkdown`| `tiptap → markdown`               | bare URL line (e.g. `https://youtu.be/<id>`) |
| `tiptapNodeToHtml`    | `tiptap → html`, `markdown → html`| canonical placeholder div |

The three canonical body representations across format-switch are:

| Format   | Canonical form |
| -------- | -------------- |
| tiptap   | `{ type: 'amplessYoutube', attrs: { videoId, start } }` Node |
| markdown | bare `https://youtu.be/<id>` URL line |
| html     | `<div data-ampless-youtube data-video-id="<id>" …>…</div>` |

The placeholder div is the canonical HTML form for **admin format-switch
interop only**: it is what `Node.renderHTML` emits, and what
`Node.parseHTML`'s `tag: 'div[data-ampless-*]'` rule restores from, so
that switching `tiptap ↔ markdown ↔ html` in the admin preserves embeds
losslessly.

**Public render of `format: 'html'` posts expands the placeholder when
the plugin declares `htmlPlaceholder`.** All three public render paths
reach the same `contentFields.tiptap` renderer: tiptap posts go through
the React walker that consults the `contentFields.tiptap` registry
(= real iframe for `amplessYoutube` Nodes); markdown posts go through the
markdown walker that consults `contentFields.markdownUrl` (= real iframe
for bare URL paragraphs); html posts go through the **public html walker**
that consults `contentFields.htmlPlaceholder` (= real iframe for
top-level `<div data-ampless-youtube …>` placeholders). The
`tiptapNodeToHtml` adapter above only governs the **admin format-switch**
interchange form — declaring `htmlPlaceholder` is what makes the public
html walker expand that form on render. (See the dedicated
`htmlPlaceholder` section below for the contract.) `publicHtmlForPost`
still only emits `beforeContent` / `afterContent` slots and does not
transform the body.

A plugin that ships an embed node but does **not** declare
`htmlPlaceholder` keeps the old behaviour: the placeholder div is shipped
literally on public render of `format: 'html'` posts (the inner canonical
URL link is still clickable, so it degrades gracefully). Save as `tiptap`
or `markdown` to get the iframe in that case.

#### Adapter contract

Both adapters have the same signature:

```ts
(node: TiptapRenderNode) => string | null
```

Return a **string** (including empty string `''`) to use your output.
Return **`null`** to fall through to the default switch (useful for nodes
you don't handle or for degenerate inputs like a missing video id).

```ts
// packages/plugin-youtube/src/editor.tsx
import type { TiptapNodeMarkdownAdapters, TiptapNodeHtmlAdapters } from 'ampless'

export const tiptapNodeToMarkdown: TiptapNodeMarkdownAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null   // fall through
    return `https://youtu.be/${videoId}`
  },
}

export const tiptapNodeToHtml: TiptapNodeHtmlAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null   // fall through
    // placeholderAttrs() is a plugin-local helper that returns the same
    // attribute dict used by Node.renderHTML — single source of truth.
    const attrs = placeholderAttrs(node.attrs ?? {})
    // Inner content is the canonical URL as a clickable link, not the
    // editor's visual label `<span>YouTube: id</span>`. Public render of
    // `format: 'html'` posts shows this content literally; an editor
    // label would leak. The URL link gracefully degrades — viewers
    // without iframe expansion still get a clickable link, and it
    // mirrors the markdown canonical form. parseHTML reads the
    // `data-video-id` attribute, so the inner content is irrelevant
    // for round-trip.
    const url = `https://youtu.be/${videoId}`
    return `<div ${attrsToHtmlString(attrs)}><a href="${escapeAttr(url)}">${escapeAttr(url)}</a></div>`
  },
}
```

#### Wiring

`update-ampless` reads the `tiptapNodeToMarkdown` and `tiptapNodeToHtml`
named exports from each plugin's `./editor` module (via namespace import `*
as`) and wires them into both installs automatically — **no hand-wiring
required**. If your plugin does not export one of the maps, the `?? {}`
fallback in the generated file is a no-op.

#### `markdown → html` 2-hop

The `markdown → html` direction reuses the `tiptapNodeToHtml` adapter via
a 2-hop:

1. `markdownToHtml(body)` — marked converts the markdown body to HTML. Bare
   URL lines become `<p><a href="URL">URL</a></p>`.
2. `generateJSON(html, extensions)` — tiptap parses the HTML. Your plugin's
   `Node.parseHTML` `tag: 'p'` rule promotes the bare-URL paragraph to the
   embed Node.
3. `tiptapToHtml(doc, { nodeAdapters })` — the html adapter serialises the
   embed Node to the placeholder div.

This means your plugin only needs to export the `tiptap → html` adapter once;
the `markdown → html` direction reuses it automatically through tiptap's parse
rules. **No duplicate logic is needed.**

#### Public html walker: `htmlPlaceholder`

To make `format: 'html'` posts render placeholder divs as real embeds on
the public page, add an **`htmlPlaceholder`** declaration to your existing
`contentFields` `tiptap` entry. You write **no new renderer** — the walker
calls the same `render(node, ctx)` your tiptap entry already uses, so all
three formats (tiptap / markdown / html) reach one renderer with no
divergence.

```ts
// packages/plugin-youtube/src/index.tsx
contentFields: [
  {
    kind: 'tiptap',
    nodeType: 'amplessYoutube',
    render: (node) => {
      const videoId = String(node.attrs?.videoId ?? '')
      const startRaw = node.attrs?.start
      const start =
        typeof startRaw === 'number' && Number.isFinite(startRaw) ? startRaw : undefined
      return <YouTubeEmbed videoId={videoId} start={start} />
    },
    htmlPlaceholder: {
      // The marker attribute that flags a top-level placeholder div.
      flagAttr: 'data-ampless-youtube',
      // Convert the div's HTML attributes into the tiptap node `attrs`
      // your `render` expects — WITH the right types. The walker is
      // type-agnostic, so coerce here (e.g. data-start string → number).
      attrsFromElement: (attribs) => {
        const start = Number(attribs['data-start'])
        return {
          videoId: attribs['data-video-id'] ?? '',
          start: Number.isFinite(start) ? start : undefined,
        }
      },
    },
  },
  // …markdown-url entry unchanged…
]
```

On public render of a `format: 'html'` post, the runtime parses the body
server-side (`htmlparser2`), finds each **top-level** element carrying
`flagAttr`, builds a `{ type: nodeType, attrs: attrsFromElement(attribs) }`
node, and calls `render(node, ctx)`. Everything else passes through as the
**original-string slices** (byte-for-byte; no DOM re-serialisation).

Constraints worth knowing:

- **Top-level only.** Placeholder divs nested inside `<blockquote>`,
  `<li>`, etc. stay literal — consistent with the editor's body-level-only
  `parseHTML` fallback. Only depth-0 elements expand.
- **`flagAttr` is matched case-insensitively.** htmlparser2 lowercases
  HTML attribute names while parsing, and the runtime lowercases your
  `flagAttr` at registration, so `<div DATA-AMPLESS-YOUTUBE …>` and
  `<div data-ampless-youtube …>` both expand. `flagAttr` can be any
  attribute name — a site-local plugin may use `data-my-embed`; there is
  no fixed `data-ampless` prefix requirement.
- **Graceful degradation.** If `attrsFromElement` or `render` throws, the
  runtime logs a `console.warn` and falls back to the **raw placeholder
  slice** (the inner canonical URL link stays clickable) rather than
  dropping the engineer-authored content.
- **Page-level scripts.** If your embed needs a third-party script (e.g.
  x.com's `widgets.js`), your `publicPostScript` / detection helper must
  also recognise the placeholder form. `plugin-x-embed`'s `hasTweetIn`
  matches both `twitter-tweet` and `data-ampless-tweet` in `format: 'html'`
  bodies so widgets.js is injected for the expanded blockquote to hydrate.

**Wrapper-boundary change.** A placeholder-free `format: 'html'` post is
emitted as a single wrapper `<div>` (the fast path — markup-identical to
the previous raw passthrough). A post **with** placeholders becomes
**multiple wrapper divs interleaved with the React embed siblings**: the
bytes inside each raw chunk are preserved exactly, but the wrapper
boundaries shift. Direct-child / adjacent-sibling CSS selectors that
assumed one wrapper around the whole body will not match the same way.
This is the accepted trade-off for expanding embeds in-place.

### Markdown to tiptap restoration

If an editor Node serializes to markdown as a bare URL line, the reverse
direction must be handled by `Node.parseHTML()`, not by paste rules. The
admin's `markdown → tiptap` format switch first converts markdown to HTML;
GFM autolinks emit a bare URL line as
`<p><a href="https://...">https://...</a></p>`, then tiptap parses that
HTML into a document. Paste rules only run for user paste / typing events,
so they do not fire on this HTML parse path.

Embed-style Nodes should add a high-priority parse rule for the paragraph
shape above, and may also add an `a[href]` rule for other HTML-to-tiptap
paths. The paragraph rule should only match when the paragraph contains a
single link whose text equals its `href`; that lets the parser replace the
whole paragraph with the block embed Node instead of leaving an empty
paragraph before the embed. `getAttrs` should validate the URL and return
`false` for non-matching links so the normal Link mark remains in place.

### Active source and full disable

**The active source for editor wiring is `package.json#dependencies`**
(= `node_modules`), not `cms.config.ts`. This means:

- Removing a plugin from `cms.config.ts` but keeping it in
  `package.json` leaves the editor paste rule active. The editor can
  still insert the node type into the tiptap document, but the public
  renderer won't render it (inconsistent state — avoid).
- To fully disable a plugin's editor extension: remove it from
  `cms.config.ts` **and** run `npm uninstall @ampless/plugin-...`,
  then `npm run update-ampless` to regenerate the bootstrap file.

### Editor preview pipeline

The admin's edit / new post forms render the preview pane in an
`<iframe sandbox="allow-scripts allow-same-origin">` whose `srcDoc` is the HTML returned
by the template's preview Route Handler. The template scaffold ships
the handler at `app/(admin)/admin/preview/route.tsx`:

```tsx
// templates/_shared/app/(admin)/admin/preview/route.tsx
import type { Post } from 'ampless'
import { admin } from '@/lib/admin'

export async function POST(req: Request): Promise<Response> {
  const session = await admin.getServerSession()
  if (!admin.isEditor(session)) {
    return new Response('Forbidden', { status: 403 })
  }
  let draft: Post
  try {
    draft = (await req.json()) as Post
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const ampless = await admin.getAmpless()
  const node = (
    <>
      {await ampless.renderBody(draft)}
      {await ampless.publicPostScriptsForPage([draft])}
    </>
  )
  // Dynamic import: see "Why a Route Handler" below.
  const { renderToStaticMarkup } = await import('react-dom/server')
  return new Response(renderToStaticMarkup(node), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
```

`<PostForm>` / `<PostHistoryPanel>` POST the draft to `/admin/preview`
out of the box — no extra wiring at the call site:

```tsx
// templates/_shared/app/(admin)/admin/posts/[postId]/page.tsx
import { admin } from '@/lib/admin'
import { createEditPostPage } from '@ampless/admin/pages'

export default createEditPostPage(admin)
```

If the admin is mounted at a non-default path (Next.js `basePath` or
a custom prefix), override the endpoint via the page factory's
`previewEndpoint` option:

```tsx
export default createEditPostPage(admin, { previewEndpoint: '/cms/admin/preview' })
```

Why a Route Handler rather than a Server Action: putting
`react-dom/server`-driven rendering inside a `'use server'` module
makes Next.js 15+ refuse to compile the edit-post page, because the
build traces the import graph from Client Components through Server
Action modules and any reach to `react-dom/server` along that path
trips the "You're importing a component that imports
react-dom/server" check. A Route Handler decouples the rendering
from that graph entirely — `<PostForm>` fetches a plain HTTP
endpoint and the bundler never walks from the form into here. The
handler's explicit `admin.isEditor()` check also defends against
accidental exposure if the `(admin)` route-group gate is ever
misconfigured. The `react-dom/server` import itself is dynamic
because Next.js 16's Turbopack flags any top-level static import of
`react-dom/server` reached from the app router build, Route Handlers
included; deferring it to request time keeps the module outside the
build-time import-graph walker while still loading it from the same
Node.js subpath at runtime.

**Preview iframe sandbox — v1 trust boundary expansion:** The iframe uses
`sandbox="allow-scripts allow-same-origin"`. With `srcDoc`, this gives
the iframe the admin's origin, which 3rd-party embed widgets (YouTube SDK,
x.com `widgets.js`) require — they refuse to initialise in an opaque-origin
(`allow-scripts`-only) iframe because they need access to non-HttpOnly
storage / cache and real-origin requests. Same-origin also gives the
preview script access to the admin's auth state / non-HttpOnly storage /
DOM and lets it issue authenticated same-origin XHR / fetch.

This is an explicit v1 design decision, not a no-op sandbox relax:
**ampless v1 treats admin preview content / plugin script as trusted**.
The engineer audits plugins before npm-installing them (customization-based
CMS model), and body content is produced by trusted editors of this site.
`<PostHistoryPanel>` can also surface a past revision authored by a
different editor (revision author ≠ preview viewer) — v1 explicitly puts
both inside the trust ring. The safer alternative — separate-origin preview
route + CSP / COEP / COOP — is parked for v2.0+ if/when a real plugin
marketplace lands.

---

## 7. Async event hooks

`hooks` runs inside the trust_level-matched processor Lambda when an
event arrives via SQS.

### Return value reservation

`PluginEventHandler` returns `Promise<void | PluginHookResult>`. The
runtime currently ignores the return value entirely — existing
plugins returning `Promise<void>` keep working without migration.
`PluginHookResult` is reserved for a future directive (likely first:
`metrics?: Record<string, number>` for observability emission);
declaring it today is a forward-compatibility hint. Note: rewrite
or cancel directives are NOT enabled by this widening alone — they
require additional `before:*` event support and payload extensions
in separate PRs.

`PluginHookResult` carries a private `__amplessPluginHookResult`
marker so that the union does not silently accept unrelated promise
types (`Promise<string>` / `Promise<number>` etc.) — plugin authors
do not need to set this field.

### Runtime context

The runtime context (`ctx`) carries:

```ts
interface PluginRuntimeContext {
  site: Config['site']
  listPublishedPosts(): Promise<Post[]>   // trusted only
  writePublicAsset(key: string, body, contentType): Promise<string>  // trusted only
}
```

Example: RSS plugin (see [`packages/plugin-rss/src/index.ts`](https://github.com/heavymoons/ampless/blob/main/packages/plugin-rss/src/index.ts)):

```ts
hooks: {
  'content.published': async (_event, ctx) => {
    const posts = await ctx.listPublishedPosts()
    const xml = buildRssFeed(posts, ctx.site)
    await ctx.writePublicAsset('feed.xml', xml, 'application/rss+xml')
  },
  'content.unpublished': /* same */,
  'content.deleted': /* same */,
  'content.updated': /* same */,
}
```

### `writePublicAsset`

Trusted plugins that write public generated files should declare the
capability:

```ts
capabilities: ['eventHooks', 'writePublicAsset']
```

If the same plugin implements `metadata()` or `siteMetadata()`, also
declare `metadata`. That capability name covers both metadata
functions; there is no separate `siteMetadata` capability.

The trusted processor writes under:

```txt
public/plugins/<instanceId ?? name>/<key>
```

`key` must match the allowlist `[A-Za-z0-9._/-]+`. Anything outside
that — spaces, URL-reserved characters (`#`, `?`, `&`, `=`, `+`),
non-ASCII (`日本語.xml`), empty strings, absolute paths (leading `/`),
`.` / `..` path segments, backslashes, control characters, or keys
over 256 characters — is rejected before S3 is called. Nested paths
such as `indexes/posts.json` and dotted extensions such as
`feed.v2.xml` are allowed. The allowlist is deliberately tight so
the returned public URL and the underlying S3 key are byte-identical
strings; URL-reserved characters would survive S3 but reshape the URL
when a consumer parses it. If you need to include user-supplied
characters in a key, sanitize first (e.g. hash, slugify) before
calling `ctx.writePublicAsset()`. The return value is the public URL
for the written object.

During the migration period, plugins with no `capabilities` field
keep working. Plugins that do declare `capabilities` but omit
`writePublicAsset` warn once when they actually call
`ctx.writePublicAsset()`.

### Best practices

- **Be idempotent.** SQS delivery is at-least-once: the same event
  may fire twice. Writing the same output twice should produce the
  same effect (e.g. a deterministic feed).
- **Don't read events.payload.\* fields you didn't declare.** The
  shape is documented in [`docs/architecture/05-event-system.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/05-event-system.md);
  drifting consumers break silently when the shape moves.
- **Errors propagate to DLQ.** Throwing inside a hook eventually
  parks the message in the dead-letter queue. Use the normal
  CloudWatch dashboards to surface failures.

---

## 8. `settings.public` — admin-managed values (Phase 2)

Declare a `settings.public` manifest and the host gets a
`/admin/plugins` editor for those values automatically.

```ts
settings: {
  public: [
    {
      type: 'text',
      key: 'measurementId',
      label: { en: 'Measurement ID', ja: '測定 ID' },
      description: { en: 'GA4 ID, blank to disable', ja: '空で無効化' },
      pattern: '^$|^G-[A-Z0-9]+$',
      placeholder: 'G-XXXXXXXX',
      default: 'G-XXXXXXXX',
    },
  ],
}
```

### Available field types

| Type | Stored as | Notes |
|---|---|---|
| `text` | string | `pattern`, `maxLength`, `placeholder` |
| `textarea` | string | `rows`, `maxLength` |
| `url` | string | scheme-checked at save time, `allowRelative` |
| `code` | string | `language` label (display only), Phase 2.5 will swap in a dedicated editor |
| `boolean` | boolean | rendered as checkbox |
| `number` | number | `min` / `max` / `step` |
| `select` | string (matches one `options[i].value`) | required to be in `options` |
| `json` | decoded value (object / array / number / boolean) | admin form `JSON.parse`s before saving |

### Storage shape

Each saved value lands in DynamoDB at:

```
pk = 'siteconfig'
sk = 'plugins.<instanceId>.<fieldKey>'
```

The trusted processor mirrors the row to `public/site-settings.json`
in S3. The public runtime fetches that file (60 s `revalidate`,
`site-settings` cache tag) when `publicHead` / `publicBodyEnd` run,
giving you cheap synchronous reads from inside the render path.

### Required vs disabled vs unset

- `required: true` rejects empty / undefined values at save time
  and surfaces an admin form error.
- For **string-like fields** (`text` / `textarea` / `url` / `code`),
  saving an empty string is **valid** when `required` is falsy.
  It's the "disable" sentinel — e.g. GA4 saves an empty
  `measurementId` to turn analytics off without removing the
  plugin.
- For **non-string fields** (`number` / `boolean` / `json` /
  `select`), empty string is always rejected. To clear a stored
  value entirely, the user clicks **Reset to default** — that
  deletes the DDB row so the next request falls back to
  `manifest.default`.

---

## 9. Reading settings: `ctx.setting<T>(key)`

Inside `publicHead` / `publicBodyEnd`, read the resolved value via
`ctx.setting`:

```ts
publicHead(ctx) {
  const id = ctx.setting<string>('measurementId') ?? ''
  if (!id) return []
  return [/* descriptors using id */]
}
```

Resolution order, per request:

```
stored value (validated)
  ↳ manifest.default (also validated)
    ↳ undefined
```

Validation runs on both sides so a manually-edited DDB row that's
out of range (or a malformed constructor argument seeded as
`default`) doesn't leak into the page. The renderer treats invalid
values as if they didn't exist; the next valid layer takes over.

When does the snapshot update? When the trusted processor finishes
rebuilding `public/site-settings.json`, the next request inside the
~60 s Next.js fetch cache window still serves the old version. The
admin form deliberately delays its cache-invalidation call by ~8 s
so the rebuild has time to finish before the public side hits
origin.

### Multiple instances

Each plugin instance has its own settings namespace keyed by
`instanceId`. Two `analyticsGa4Plugin({ instanceId: 'a' })` and
`analyticsGa4Plugin({ instanceId: 'b' })` calls in `cms.config.ts`
get distinct DDB rows; `ctx.setting()` automatically scopes to the
plugin's own `instanceId`.

---

## 9a. Secret settings: `ctx.secret<T>(key)` (Phase 6a)

Secret settings let trusted plugins store and rotate credentials
(webhook signing secrets, SMTP passwords, external API tokens)
through the admin UI **without exposing them to the public site or
browser-side code**.

### Why a separate API from `settings.public`?

Values in `settings.public` are designed to flow to the public
runtime: they're mirrored to `public/site-settings.json` and read
by `ctx.setting()` inside sync render surfaces. That flow is
intentional for analytics measurement IDs, consent category names,
etc. — but completely wrong for a webhook signing secret.

`settings.secret` has a structurally different storage model:

- Stored in the `PluginSecret` DynamoDB table (separate from KvStore).
  Admin/editor Cognito users have **no direct AppSync access** to this
  table — all writes go through the `setPluginSecret` mutation, which
  is backed by the `plugin-secret-handler` Lambda.
- Values are **AES-256-GCM encrypted** before reaching DynamoDB.
  The admin browser sends the plaintext to the Lambda via AppSync
  (TLS in transit); the Lambda validates it, reads the 32-byte
  encryption key from `process.env.PLUGIN_SECRET_ENCRYPTION_KEY`
  (injected by CDK from `amplify/secrets/encryption-key.ts`), encrypts
  the value, and writes only the ciphertext to DDB. The plaintext
  never rests in DynamoDB and never flows back to the browser.
- **Threat model (Phase 6a v2.2)**:

  | Threat | Status |
  |---|---|
  | AWS Console operator browsing PluginSecret table | ✓ defeated — ciphertext only, no key in DDB |
  | Source repo / deploy artifact access | ⚠ NOT defeated — key is in `amplify/secrets/encryption-key.ts`. For public repos, keep the key out of source control (for example with `npx create-ampless@beta setup-encryption-key --gitignore`) and restrict deploy artifact access. |
  | Malicious trusted plugin in same Lambda | ✗ NOT defeated — `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` reachable from plugin code. True isolation = per-plugin Lambda (privileged tier, roadmap). |
  | S3 mirror leak | ✓ defeated — PluginSecret table never mirrored. |

- The trusted-processor Lambda decrypts with `node:crypto` on read.
  `ctx.secret<T>(key)` returns the plaintext string, never the
  ciphertext.
- Never queried by the site-settings mirror path.
- Never passed to any public-render surface
- **Field-manifest validation scope**: the admin client validates
  `pattern` / `maxLength` / `required` for UX feedback, but the
  Lambda only enforces a generic 10,000-character hard cap + safe-
  character sanitizer. An admin/editor calling the AppSync mutation
  directly can bypass field-level constraints — by design, since
  admin/editor are trusted operators authorised to set secrets.
  The manifest checks are UX guidance, not a security boundary.
  (`publicHead`, `publicBodyEnd`, `publicBodyForPost`,
  `publicHtmlForPost`) — those surfaces only see `ctx.setting()`.

### Requirements and `definePlugin()` behaviour

`settings.secret` has four observable behaviours at `definePlugin()` time (this is the v1 first-party organization hard gate for secret access; see [plugin.ts:1004-1019](https://github.com/heavymoons/ampless/blob/main/packages/ampless/src/plugin.ts#L1004-L1019)):

1. **`settings.secret` non-empty + `trust_level !== 'trusted'`** → `definePlugin()` **throws**. Untrusted and privileged Lambdas have no IAM read access to the `PluginSecret` table; the trusted Lambda's IAM permission is required.
2. **`settings.secret` non-empty + `capabilities` declared + `'secretSettings'` missing from `capabilities`** → **soft mismatch warning**. Matches the existing capability-mismatch pattern for `'schema'` / `'publicHtmlForPost'`.
3. **`settings.secret` non-empty + `capabilities` undefined** (legacy plugin without a `capabilities` array) → **no warning**. The mismatch check is skipped when `capabilities` is `undefined`, for backward compatibility.
4. **`capabilities: ['secretSettings']` declared with no `settings.secret` field** → **no-op**. Neither warning nor throw.

To use `settings.secret`, you also need:
1. `trust_level: 'trusted'` (requirement #1 above; `definePlugin()` throws otherwise).
2. `'secretSettings'` in `capabilities` (omitting it when `capabilities` is defined produces a console warning).
3. **One-time key setup** — run from your project root:
   ```sh
   npx create-ampless@beta setup-encryption-key
   ```
   This generates a cryptographically random 32-byte key and writes
   it to `amplify/secrets/encryption-key.ts`. No AWS credentials
   required — this is a local file operation only.

   Then import the constant in `amplify/backend.ts` and pass it to
   `defineAmplessBackend({ pluginSecretEncryptionKey })`. Redeploy (or
   restart the sandbox) to inject the key into the Lambda env vars.

   For public repos, pass `--gitignore` to exclude the key file from
   version control and distribute the key separately.

### Dual-write integrity

The `setPluginSecret` and `clearPluginSecret` operations each write
to **two DynamoDB tables** in sequence: `PluginSecret` (ciphertext)
and `PluginSecretIndicator` (existence timestamp). If the second
write fails, the tables are left in a predictable, documented state:

| Failure point | `PluginSecret` | `PluginSecretIndicator` | `ctx.secret()` | `hasPluginSecret()` |
|---|---|---|---|---|
| **set**: indicator PutItem fails | ciphertext present | absent | returns plaintext ✓ | `false` (UI: "not saved") |
| **clear**: indicator DeleteItem fails | absent | stale (old timestamp) | `undefined` ✓ | `true` (UI: "saved") |

The clear-path failure is the "safe side": the secret stops firing even
though the UI briefly shows it as saved. The set-path failure is a minor
UI inaccuracy: the secret is functional but the existence indicator is
absent until a retry succeeds.

### Declaring secret fields

```ts
import { definePlugin } from 'ampless'

export default function webhookPlugin(opts?: { signingSecret?: string }) {
  // Keep any constructor-provided secret as a closure-private fallback.
  // It is NEVER exposed in the manifest or the stored descriptor.
  const constructorSecret = opts?.signingSecret

  return definePlugin({
    name: 'webhook',
    apiVersion: 1,
    trust_level: 'trusted',
    capabilities: ['eventHooks', 'secretSettings'],
    settings: {
      secret: [
        {
          type: 'text',
          key: 'signingSecret',
          label: { en: 'Webhook signing secret', ja: 'Webhook 署名 secret' },
          maxLength: 256,
          required: false,
          // NO `default` — secret fields forbid it at the type level.
          // Use a closure-private fallback instead (see below).
        },
      ],
    },
    hooks: {
      async 'content.published'(event, ctx) {
        // ctx.secret() reads from PluginSecret DDB table.
        // Returns undefined when no value has been saved by admin yet.
        const storedSecret = await ctx.secret<string>('signingSecret')

        // Closure-private fallback: use the constructor argument when
        // the admin has not saved a value yet. This preserves backward
        // compatibility with sites that pass the secret at install time.
        const secret = storedSecret ?? constructorSecret
        if (!secret) return // no secret → skip signing

        // ... use secret to sign and POST
      },
    },
  })
}
```

### Important: no `default` on secret fields

The type `PluginSecretField` is defined as `Omit<PluginTextField,
'default'> | Omit<PluginTextareaField, 'default'>` — the `default`
property is **removed at the type level** and TypeScript will error
if you try to add one.

This is intentional: `default` values propagate into admin UI form
props (visible in the browser), static manifests cross-checked by
the runtime, and JS bundles. For a credential, these are all leak
paths.

If you have a fallback value (e.g. the constructor argument), keep
it as a **closure-private variable** inside the plugin factory
function — never in the manifest:

```ts
// ✓ correct — closure-private, never in the manifest
const constructorSecret = opts?.signingSecret

// ✗ wrong — TypeScript error, would also leak to browser
settings: {
  secret: [{
    type: 'text',
    key: 'signingSecret',
    label: 'Secret',
    default: opts?.signingSecret, // ← TS compile error
  }],
}
```

### Reading secrets: `ctx.secret<T>(key)`

`ctx.secret<T>(key)` is only available in trusted hook handlers
(injected by `processor-trusted.ts`). The signature is:

```ts
ctx.secret<T = string>(key: string): Promise<T | undefined>
```

- Returns `undefined` when no value has been saved by admin yet.
- The generic `T` is a convenience cast (same as `ctx.setting<T>()`).
  Values are always stored as strings; `T` defaults to `string`.
- Results are per-invocation cached. Calling `ctx.secret('key')`
  twice in the same hook batch costs one DDB round-trip (and one
  decrypt). The encryption key is decoded from the Lambda env var
  at cold-start (no extra DDB fetch).
- Cache keys are namespaced: `${instanceId ?? name}:${fieldKey}`.
  Two plugin instances both declaring `'signingSecret'` never get
  each other's values.
- The cached value is the **decrypted plaintext** — not the
  ciphertext. There is no redundant decrypt on repeated calls.

### Admin UI

When `settings.secret` is declared, the admin plugin settings page
renders a **Secret settings** section below the public fields.
Each secret field shows:

- **Unset**: a plain text input + Save button.
- **Stored**: a masked placeholder `••••••••` + Replace + Clear
  buttons. The actual value is never fetched or displayed.
- **Editing**: after clicking Replace — new text input + Save + Cancel.

Admins can rotate a secret at any time without redeploying. The
change takes effect on the next trusted-Lambda invocation (within
~5–10 seconds of saving).

### Testing hooks that use `ctx.secret`

Mock `ctx.secret` alongside the other context methods:

```ts
import { describe, it, expect, vi } from 'vitest'
import webhookPlugin from './index.js'
import type { TrustedPluginRuntimeContext } from 'ampless'

function makeCtx(secrets: Record<string, string> = {}): TrustedPluginRuntimeContext {
  return {
    site: { name: 'Test', url: 'https://example.com' },
    listPublishedPosts: vi.fn().mockResolvedValue([]),
    writePublicAsset: vi.fn().mockResolvedValue(''),
    secret: vi.fn().mockImplementation(async (key: string) => secrets[key]),
  }
}

describe('webhookPlugin signing', () => {
  it('uses admin-stored secret when available', async () => {
    const plugin = webhookPlugin()
    const ctx = makeCtx({ signingSecret: 'stored-secret' })
    await plugin.hooks?.['content.published']?.({ type: 'content.published', payload: {} as never }, ctx)
    // assert that the request was signed with 'stored-secret'
  })

  it('falls back to constructor secret when admin has not saved one', async () => {
    const plugin = webhookPlugin({ signingSecret: 'fallback-secret' })
    const ctx = makeCtx({}) // no stored secret
    await plugin.hooks?.['content.published']?.({ type: 'content.published', payload: {} as never }, ctx)
    // assert that the request was signed with 'fallback-secret'
  })
})
```

---

## 9b. Where your plugin's data lives

Plugin-owned data may live in the five storage areas listed below; the
**current write paths differ by area** and fall into three families:

- **KvStore** — admin/editor write through AppSync. Plugin hooks have no
  KvStore write helper today.
- **PluginSecret + PluginSecretIndicator** — written by the
  `plugin-secret-handler` Lambda, which is invoked by admin/editor through
  the `setPluginSecret` / `clearPluginSecret` AppSync mutations. The
  trusted processor reads `PluginSecret` via `ctx.secret<T>()` but does
  NOT write to either secret table.
- **S3 `public/plugins/{instanceId ?? name}/*`** — written by the trusted
  Lambda's hook context (`ctx.writePublicAsset(...)`). This is the only
  area a plugin hook writes to directly today.

All other areas — the `Post`, `Page`, `Media`, and `PostTag` DynamoDB
tables, the `public/site-settings.json` S3 mirror, and any other plugin's
namespace — are off-limits. The runtime does not enforce this today; it is
a contract enforced by trust (and future IAM hardening).

| Area | Path / identifier | Access level | Phase |
|---|---|---|---|
| KvStore (admin settings) | DynamoDB `pk='siteconfig'`, `sk='plugins.<instanceId>.<fieldKey>'` | admin/editor via AppSync; plugin hook write helper is not provided today | Phase 2 |
| KvStore (runtime state/cache) | DynamoDB `pk='pluginstate:<plugin>:...'` with optional TTL | admin/editor via AppSync; plugin hook write helper is not provided today | Current |
| PluginSecret | DynamoDB `PluginSecret` table, `sk='plugins.<instanceId>.<fieldKey>'` | `trusted` only (IAM-only AppSync auth) | Phase 6a |
| PluginSecretIndicator | DynamoDB `PluginSecretIndicator` table, `sk='plugins.<instanceId>.<fieldKey>'` | `trusted` + admin/editor (read indicator) | Phase 6a |
| S3 plugin assets | `public/plugins/{instanceId ?? name}/*` | `trusted` only (`writePublicAsset`) | Phase 3 |

**Cleanup is not automatic.** Removing a plugin from `cms.config.ts` leaves
orphan data in all five areas. Manual operator cleanup is required until the
future lifecycle-dispatch PR ships the invocation mechanism for the `uninstall`
hook (see §9c below).

**Custom DynamoDB tables.** If your plugin provisions its own DynamoDB table
outside the ampless schema, lifecycle management (including cleanup on uninstall)
is your responsibility. ampless has no visibility into external tables and the
future `uninstall` cleanup grants cover only the five areas above.

See [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#plugin-owned-data-areas)
for the full rationale and the IAM grant design.

---

## 9c. `uninstall` hook (Phase 1 reservation)

`AmplessPlugin.uninstall` is a **Phase 1 type reservation** — the runtime does
not call it today. Its purpose is to lock in the hook name and signature before
any plugin code ships, so the future lifecycle-dispatch PR can wire the
invocation without renaming or reshaping anything.

**Phase 1 scope**: only the hook name and signature are reserved. The `ctx`
does **not** yet carry cleanup helpers (`deletePublicAsset` /
`deletePluginSetting` / `deletePluginSecret`) — writing
`await ctx.deletePublicAsset(...)` today is a TypeScript error. When those
helpers land (in the lifecycle-dispatch PR), they are added to
`PluginUninstallContext` additively, with no breaking change to plugins that
declared an empty body in advance.

**Recommended declaration today** — an empty body:

```ts
// Example: a trusted plugin that writes assets and stores secrets
definePlugin({
  name: 'my-trusted-plugin',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['eventHooks', 'writePublicAsset', 'secretSettings'],
  hooks: { 'content.published': async (_evt, ctx) => { /* ... */ } },
  uninstall: async (_ctx) => {
    // Phase 1 reservation: the runtime does not invoke this hook
    // today, AND `ctx` does not yet carry cleanup helpers
    // (`deletePublicAsset` / `deletePluginSetting` /
    // `deletePluginSecret`). Declaring an empty body is the
    // recommended forward-compat shape — when the future
    // lifecycle-dispatch PR ships, the helpers land on
    // `PluginUninstallContext` additively, and you fill in the
    // body THEN. Plugins that shipped the empty declaration
    // today do not need to re-publish for the signature change,
    // but a re-publish is required to add the actual cleanup
    // body.
  },
})
```

**Idempotency.** When the lifecycle-dispatch PR ships, the `uninstall` hook
runs in a trusted-Lambda IAM context. The SQS delivery is at-least-once, so
your cleanup body may run more than once — design it to be safe to retry
(e.g. `deleteObject` is idempotent on S3; a conditional `delete` on DDB is
safe if the key is already gone).

---

## 9d. When you change settings shape (Phase 1 reservation)

### What happens today: `public` and `secret` travel through different paths

Shape changes are absorbed silently by today's runtime, but the actual
behaviour differs between `settings.public` and `settings.secret` because
they use entirely different write/read paths.

#### `settings.public` (lenient resolver via `resolvePluginSettings`)

`resolvePluginSettings` ([packages/ampless/src/plugin-settings.ts](packages/ampless/src/plugin-settings.ts))
iterates `manifest.public` and falls back to `field.default` per field. The
resolver never looks at `manifest.secret`.

| Change | Behaviour today (public fields) |
|---|---|
| **Field added** | New field resolves via `manifest.default` — stored value is absent, default takes over. |
| **Field deleted** | Orphan row remains in KvStore. `resolvePluginSettings` silently skips keys that are not in the current manifest. |
| **Field renamed** (`endpoint` → `url`) | Treated as deletion + addition: old value is unreachable (orphan), new field resolves via `default`. |
| **Type changed incompatibly** | New validator runs on the stored value. If it passes, the value is used. If it fails, falls through to `default` (or `undefined`). |

#### `settings.secret` (admin UI + `PluginSecret` + `ctx.secret()`, no lenient resolver)

Secret fields are never read by `resolvePluginSettings`. They travel a
separate path:

- The admin UI writes individual values through the `setPluginSecret`
  AppSync mutation, which the `plugin-secret-handler` Lambda encrypts and
  stores in the `PluginSecret` DynamoDB table.
- Trusted hooks read them individually by key via `ctx.secret<T>(key)`,
  which goes directly to `PluginSecret` and decrypts.
- The `PluginSecretField` type forbids `default` — there is no
  manifest-level fallback for secret values.

| Change | Behaviour today (secret fields) |
|---|---|
| **Field added** | New field appears in the admin UI. Until an admin sets a value, `ctx.secret<T>(key)` returns `undefined`. |
| **Field deleted** | The field disappears from the admin UI, but the encrypted row in `PluginSecret` is orphaned. No resolver runs over it; an operator must delete it manually. |
| **Field renamed** | Old key's encrypted row is orphaned (no resolver / cleanup). The new key shows up unset. Admin must re-enter the value under the new key. |
| **Type changed incompatibly** | `validatePluginSettingValue` only runs at write time, so an existing stored ciphertext is unaffected on read; `ctx.secret<T>(key)` returns whatever was last written. A re-validate on admin save would reject incompatible new input. |

No error or warning is produced in any of these cases. Plugin authors must
inspect their stored values manually if they need to verify behaviour
after a shape change.

### The `version` reservation

`PluginSettingsManifest.version?: number` is a **Phase 1 type
reservation** — the runtime does NOT read it today. Declaring it has no
effect on the lenient resolver above.

The reservation exists so that a future migration PR may persist the
active manifest version somewhere alongside stored values and compare it to
`manifest.version` at resolve time to detect mismatch. The exact mismatch
response (warn / skip / migrate in-place / trigger an admin-driven flow) is
design territory for that future PR.

**What declaring `version` today does NOT promise:**

- It does NOT trigger any migration body.
- It does NOT cause the runtime to re-validate or re-default stored values.
- It does NOT reserve a `migrate` hook signature — that is a separate future
  design.

**What declaring `version` today does do:**

- It positions the plugin to be picked up by the future migration detection
  path, without requiring a re-publish just to add the `version` field once
  that PR ships.
- It communicates intent to future maintainers that this manifest has a
  versioned shape.

### Recommended pattern

| Scenario | Recommendation |
|---|---|
| Additive change only (new optional field, default provided) | No `version` bump needed. Lenient resolver handles it. |
| Non-additive change (rename, incompatible type change, semantic shift) | Bump `version` by 1. |
| First time adding `version` to an existing manifest | Start at `version: 1`. |

**Use positive integers, starting at 1.** Do NOT use `0`, negative numbers,
or floats — the `number` type accepts them but the future migration PR may
reserve special semantics for `0` / undefined (legacy / pre-v1 conflation).

### Code example

```ts
definePlugin({
  name: 'my-plugin',
  apiVersion: 1,
  trust_level: 'untrusted',
  capabilities: ['adminSettings'],
  settings: {
    version: 2,           // ← Phase 1 reservation. Today runtime ignores.
    public: [
      { type: 'url', key: 'webhookUrl', label: 'Webhook URL', required: true },
    ],
  },
})
```

When a future migration PR ships, plugins that have already declared
`version` will be on the detection path automatically. Plugins that want to
provide an actual migration body will need to re-publish after that PR ships
to add the body. Plugins that omit `version` entirely continue with the
current lenient-resolver behaviour — no change.

---

## 10. Walk-through: migrating GA4 from Phase 1 to Phase 2

The Phase 1 GA4 plugin took the measurement ID through a
constructor argument. Phase 2 keeps the argument for backward
compatibility but reads the live value from `ctx.setting()`.

**Before** (Phase 1):

```ts
export default function analyticsGa4Plugin(opts: { measurementId: string }) {
  const { measurementId } = opts
  return definePlugin({
    name: 'analytics-ga4',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    publicHead() {
      if (!measurementId) return []
      return [/* descriptors using measurementId */]
    },
  })
}
```

**After** (Phase 2):

```ts
export default function analyticsGa4Plugin(opts: { measurementId?: string } = {}) {
  const { measurementId = '', instanceId = 'analytics-ga4' } = opts
  return definePlugin({
    name: 'analytics-ga4',
    instanceId,
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead', 'adminSettings'],
    settings: {
      public: [{
        type: 'text',
        key: 'measurementId',
        label: { en: 'Measurement ID', ja: '測定 ID' },
        pattern: '^$|^G-[A-Z0-9]+$',
        default: measurementId,
      }],
    },
    publicHead(ctx) {
      const id = ctx.setting<string>('measurementId') ?? ''
      if (!id) return []
      return [/* descriptors using id */]
    },
  })
}
```

The constructor argument now seeds `manifest.default`. Operators
that already set `analyticsGa4Plugin({ measurementId: 'G-X' })` in
`cms.config.ts` keep their current behaviour; new deployments
should leave it empty and configure the value from the admin UI.

---

## 11. Testing

ampless uses vitest. Plugin tests typically look like:

```ts
import { describe, it, expect } from 'vitest'
import type { PluginPublicRenderContext, AmplessPlugin } from 'ampless'
import { resolvePluginSettings } from 'ampless'
import myPlugin from './index.js'

function makeCtx(plugin: AmplessPlugin, stored: Record<string, unknown> = {}): PluginPublicRenderContext {
  const resolved = resolvePluginSettings(plugin.settings, stored)
  return {
    site: { name: 'Test', url: 'https://example.com/' },
    setting: (k) => resolved[k],
  }
}

it('emits descriptors when measurementId is set', () => {
  const plugin = myPlugin({ measurementId: 'G-XXX' })
  const descriptors = plugin.publicHead?.(makeCtx(plugin)) ?? []
  expect(descriptors).toHaveLength(2)
})

it('returns empty when admin saved empty string', () => {
  const plugin = myPlugin({ measurementId: 'G-XXX' })
  const descriptors = plugin.publicHead?.(makeCtx(plugin, { measurementId: '' })) ?? []
  expect(descriptors).toEqual([])
})
```

Test the manifest + the rendering behaviour. The runtime's
descriptor validator is exercised in `@ampless/runtime` already —
plugin tests focus on the *what* (which descriptors get returned for
which state), not the validation surface.

For event hooks, mock `ctx.listPublishedPosts` and
`ctx.writePublicAsset` with simple stub functions.

---

## 12. Publishing to npm

For first-party / monorepo-internal plugins, follow the changeset
flow already in this repo. For external plugins, the shape is just
a normal npm package:

- **Name**: `@your-scope/plugin-foo`. The `@ampless/plugin-*`
  scope is reserved for first-party plugins shipped from this
  monorepo.
- **Entry**: ESM only, exports default (the factory) and the
  config interface (for typed args in user `cms.config.ts`).
- **`apiVersion`**: declare `1` today — it is the only valid
  value, and the literal type rejects others at compile time.
  `apiVersion` is the breaking-change marker on the plugin
  contract, not a semver-style channel: additive changes (new
  optional fields, new reserved capabilities) stay within
  `apiVersion: 1` and do NOT require a bump. See the [apiVersion
  bump policy](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#apiversion-bump-policy)
  in the architecture doc for the full criteria.
- **Dist-tag**: `@beta` while ampless itself is in beta. The
  `@latest` tag stays reserved until ampless v1.0.

Worked examples to crib from:

- [`packages/plugin-analytics-ga4`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-analytics-ga4) — descriptor-based, Phase 2 settings.
- [`packages/plugin-gtm`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-gtm) — uses both `publicHead` (loader inline script) and `publicBodyEnd` (`<noscript>` iframe fallback) with the container ID admin-edited.
- [`packages/plugin-plausible`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-plausible) — single `<script>` descriptor with `data-*` attrs and a required URL field (self-hosted Plausible override).
- [`packages/plugin-rss`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-rss) — trusted, async event hooks + `writePublicAsset`.
- [`packages/plugin-seo`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-seo) — `metadata()` + `siteMetadata()`.
- [`packages/plugin-webhook`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-webhook) — trusted hook with outbound HTTP + `secretSettings` (admin-managed signing secret, Phase 6a).
- [`packages/plugin-og-image`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-og-image) — `ogImage` route renderer.
- [`packages/plugin-schema-jsonld`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-schema-jsonld) — `publicBodyForPost` + `schema` capability; per-post Article JSON-LD. (Phase 4)

---

## 13. Naming rules + common pitfalls

### Naming rules

- `name`, `instanceId`, every `settings.public.key`: must match
  `/^[a-zA-Z0-9_-]+$/`. The runtime drops plugins / fields that
  violate this with a dev console warning.
- The dot separator in `plugins.<instanceId>.<fieldKey>` is the
  only structure the storage format relies on. Don't try to be
  clever with nested dots in your keys.

### Common pitfalls

- **Capability + implementation mismatch.** Declaring
  `capabilities: ['publicHead']` but never defining `publicHead` (or
  vice versa) prints a console warning at startup. Either drop the
  capability or add the function.
- **Duplicate `instanceId`.** Two plugin instances sharing the same
  namespace get a startup warning. The second one's stored settings
  collide with the first.
- **Forgetting `id` on `inlineScript`.** The descriptor is dropped
  silently in production and warned in dev. There is no way for
  the runtime to dedup inline scripts without an id.
- **Returning `ReactNode` from `publicHead`.** TypeScript catches
  this — `publicHead` is typed to return descriptors only. If you
  find yourself needing arbitrary `ReactNode`, that's the Phase 6b
  `developer.headElements` capability waiting to land.
- **Saving `manifest.default` through the admin form.** Don't write
  the resolved default back as if it were an explicit value — the
  admin form only writes touched fields for exactly this reason.
  Saving a default value freezes it: future package updates that
  change the default won't take effect for that field anymore.
- **`publicBodyForPost` without `scriptType: 'application/ld+json'`.** Descriptors
  returned from `publicBodyForPost` that omit `scriptType` or use any
  other value are silently dropped in production and warned in dev.
  Only `scriptType: 'application/ld+json'` is valid in that surface.
- **`schema` capability + `publicBodyForPost` mismatch.** Declaring
  `capabilities: ['schema']` without implementing `publicBodyForPost`
  (or the reverse) prints a startup warning. Keep the declaration and
  implementation in sync.

---

## 14. Quickstart: scaffolding with `create-ampless`

For a fast path from idea to working plugin, the `create-ampless`
CLI ships a `plugin <name>` subcommand:

```bash
# Site-local: scaffolds plugins/<name>/index.ts inside the current
# ampless site. Run from the site repo root.
npx create-ampless@beta plugin my-thing \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings

# Standalone npm package: scaffolds ./<dir>/ with package.json,
# tsconfig.json, tsup.config.ts, README + .ja, CHANGELOG, .gitignore,
# and src/index.ts + src/index.test.ts. Run from wherever you want
# the new package directory to land.
npx create-ampless@beta plugin @myscope/ampless-plugin-thing \
  --standalone \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings \
  --description "What this plugin does"
```

Standalone scaffolds include everything Phase 5's cross-check needs:
`package.json#amplessPlugin`, the `./package.json` subpath export,
the `packageName` factory field, the `ampless-plugin` discovery
keyword, and a minimal vitest sample so `pnpm install && pnpm test &&
pnpm build` runs clean on the freshly generated directory.

Both modes also accept a positional flag-less invocation (`npx
create-ampless@beta plugin`) that walks you through the same
questions interactively via the @clack prompt UI.

### Publishing a standalone plugin

```bash
cd ampless-plugin-thing
pnpm install
pnpm test
pnpm build
pnpm publish --access public --tag beta
```

`--access public` is mandatory for scoped names (`@scope/...`).
`--tag beta` matches the current ampless pre-release cadence — drop
it once the package reaches a stable major.

There's a publish-to-install lag of "seconds to minutes" before
`npm install <pkg>@beta` picks up a fresh publish (CDN + registry
replica propagation). If `npm install` 404s right after `npm publish`
returns, wait 1-2 minutes and retry — `npm view <pkg>@beta version`
visible in the registry is necessary but sometimes not sufficient.

### Naming the package

By npm convention, scope and the conventional `ampless-plugin-`
prefix collapse to a short identifier for `AmplessPlugin.name`:

| npm package | `AmplessPlugin.name` |
|---|---|
| `@ampless/plugin-gtm` | `gtm` |
| `@scope/ampless-plugin-clarity` | `clarity` |
| `ampless-plugin-readme-toc` | `readme-toc` |
| `weird-name-no-prefix` | `weird-name-no-prefix` |

The scaffold does this stripping automatically. Hand-author the same
mapping if you skip the scaffold; the install-time cross-check warns
on a mismatch between the package's static manifest and the factory.

### Site-local follow-up

After a site-local scaffold:

```ts
// cms.config.ts
import myThingPlugin from './plugins/my-thing'

export default defineConfig({
  // ...
  plugins: [
    myThingPlugin(),
  ],
})
```

The scaffold prints this snippet at the end of its run — copy it into
`cms.config.ts` to activate the plugin.

`update-ampless` never touches the `plugins/` directory (it's
PROTECTED), so the scaffolded code is safe across ampless upgrades.

---

## 15. Where to ask

- Architecture / design questions → [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md)
- Bugs in a first-party plugin → file an issue against
  `heavymoons/ampless` referencing the plugin's package name.
- Bugs in the plugin runtime / admin form → same repo, label
  `area:plugins`.

The GitHub URLs above resolve in the public beta repo. The same docs
also live in the package tarball directly under
`node_modules/ampless/docs/`, so plugin authors can read them locally
without checking out this repo.
