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

§14 below has a one-command scaffold (`npx create-ampless plugin <name>`)
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
npx create-ampless@latest plugin my-thing

# Standalone npm package (writes ./<name>/ ready for `npm publish`)
npx create-ampless@latest plugin @myscope/ampless-plugin-my-thing --standalone
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
  apiVersion: 1                     // bump only when the contract changes
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
  settings?: { public?: readonly PluginSettingField[] }
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

Three tiers, picked by what the plugin needs to do **inside
event hooks** (the sync surfaces — metadata, head, body — don't
touch IAM):

| Tier | IAM | Used by |
|---|---|---|
| `untrusted` | none (SQS consume only) | head/body descriptors, webhook delivery, content transforms |
| `trusted` | read posts, write `public/plugins/<instanceId ?? name>/...` | RSS feed, sitemap, computed JSON indexes |
| `privileged` | reserved | future: SES, secrets, private S3 |

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
- **CSP nonce**: not propagated in Phase 1. The `nonce` attr is
  declared in the type for forward-compat but discarded today.
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
<div className="prose" dangerouslySetInnerHTML={{ __html: renderBody(post) }} />
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

## 7. Async event hooks

`hooks` runs inside the trust_level-matched processor Lambda when an
event arrives via SQS. The runtime context (`ctx`) carries:

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

- Stored in the `PluginSecret` DynamoDB model (separate from KvStore).
- Admin/editor groups can **write and delete** but have **no read
  authorization** — the AppSync schema does not generate
  `getPluginSecret` or `listPluginSecrets` queries for those groups.
- Only the trusted-processor Lambda IAM role can read, via DDB
  `GetItem` directly.
- Never queried by the site-settings mirror path.
- Never passed to any public-render surface
  (`publicHead`, `publicBodyEnd`, `publicBodyForPost`,
  `publicHtmlForPost`) — those surfaces only see `ctx.setting()`.

### Requirements

`settings.secret` requires:

1. `trust_level: 'trusted'` — untrusted Lambdas have no DDB read
   access to the PluginSecret table. `definePlugin()` throws if you
   declare `settings.secret` with any other trust level.
2. `'secretSettings'` in `capabilities` — required so admin UI and
   future allow-lists can gate the capability. Omitting it produces
   a console warning (same pattern as `'schema'` vs `publicBodyForPost`).

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
        const storedSecret = await ctx.secret<string>('signingSecret')
        const secret = storedSecret ?? constructorSecret
        if (!secret) return
        // ... use secret to sign and POST
      },
    },
  })
}
```

### Important: no `default` on secret fields

The type `PluginSecretField` is defined as `Omit<PluginTextField,
'default'> | Omit<PluginTextareaField, 'default'>` — the `default`
property is **removed at the type level**. Use a closure-private
fallback variable instead; never put credentials in the manifest.

### Reading secrets: `ctx.secret<T>(key)`

`ctx.secret<T>(key)` is only available in trusted hook handlers.
Returns `undefined` when no value has been saved by admin. Results
are per-invocation cached; cache keys are namespaced by
`${instanceId ?? name}:${fieldKey}`.

### Admin UI

When `settings.secret` is declared, the admin plugin settings page
renders a **Secret settings** section below the public fields.
Admins see `••••••••` for stored values and can Replace or Clear
without deploying. Rotation takes effect within ~5–10 seconds.

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
- **`apiVersion`**: bump only when the contract changes. Bump
  major when an existing field's type changes; bump minor when you
  add a new field (existing installs keep working).
- **Dist-tag**: `@alpha` while ampless itself is in alpha. The
  `@latest` tag stays reserved until ampless v1.0.

Worked examples to crib from:

- [`packages/plugin-analytics-ga4`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-analytics-ga4) — descriptor-based, Phase 2 settings.
- [`packages/plugin-gtm`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-gtm) — uses both `publicHead` (loader inline script) and `publicBodyEnd` (`<noscript>` iframe fallback) with the container ID admin-edited.
- [`packages/plugin-plausible`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-plausible) — single `<script>` descriptor with `data-*` attrs and a required URL field (self-hosted Plausible override).
- [`packages/plugin-rss`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-rss) — trusted, async event hooks + `writePublicAsset`.
- [`packages/plugin-seo`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-seo) — `metadata()` + `siteMetadata()`.
- [`packages/plugin-webhook`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-webhook) — untrusted hook with outbound HTTP.
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
npx create-ampless@latest plugin my-thing \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings

# Standalone npm package: scaffolds ./<dir>/ with package.json,
# tsconfig.json, tsup.config.ts, README + .ja, CHANGELOG, .gitignore,
# and src/index.ts + src/index.test.ts. Run from wherever you want
# the new package directory to land.
npx create-ampless@latest plugin @myscope/ampless-plugin-thing \
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
create-ampless@latest plugin`) that walks you through the same
questions interactively via the @clack prompt UI.

### Publishing a standalone plugin

```bash
cd ampless-plugin-thing
pnpm install
pnpm test
pnpm build
pnpm publish --access public --tag alpha
```

`--access public` is mandatory for scoped names (`@scope/...`).
`--tag alpha` matches the current ampless pre-release cadence — drop
it once the package reaches a stable major.

There's a publish-to-install lag of "seconds to minutes" before
`npm install <pkg>@alpha` picks up a fresh publish (CDN + registry
replica propagation). If `npm install` 404s right after `npm publish`
returns, wait 1-2 minutes and retry — `npm view <pkg>@alpha version`
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

The ampless repo stays private until v1.0 RC. Once it's public, the
links above resolve to the actual GitHub URLs; today they live in
the package tarball directly under `node_modules/ampless/docs/`.
