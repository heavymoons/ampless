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
Phase 1 + Phase 2 surfaces — descriptor-based `<head>` / `<body>`
injection, the async event hooks, and admin-managed
`settings.public` values.

The design rationale is in [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md);
this page is the hands-on companion.

---

## 1. What a plugin can do

An ampless plugin is a TypeScript module that returns an
`AmplessPlugin` object. It plugs into one or more of the following
surfaces:

| Surface | Where | Sync / async | Phase |
|---|---|---|---|
| `metadata(post, site)` | `generateMetadata()` per post | sync | Existing |
| `siteMetadata(site)` | root layout `generateMetadata()` | sync | Existing |
| `publicHead(ctx)` | root layout `<head>` | sync (called from async layout) | 1 |
| `publicBodyEnd(ctx)` | root layout end of `<body>` | sync | 1 |
| `ogImage` | `/og/[slug]` route | request-time, in public Lambda | Existing |
| `hooks` | trust_level-matched processor Lambda | async, on SQS event | Existing |
| `settings.public` | `/admin/plugins` form | declarative manifest | 2 |

What a plugin **cannot** do today (without privileged tier work, see
roadmap):

- Inject arbitrary `ReactNode` into pages — descriptor variants only.
- Open a TCP socket in the public Next.js process. Trusted Lambdas
  have outbound HTTP only.
- Add admin routes / server routes / content fields — those
  capabilities are reserved for Phase 6b.
- Read or write secrets. The `secretSettings` capability is reserved
  for Phase 6a.

---

## 2. Minimum file layout

A plugin can ship as a tiny npm package or live in your site's
monorepo. The on-disk shape is the same either way:

```
my-plugin/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts
    index.test.ts
```

See `packages/plugin-rss/` and `packages/plugin-analytics-ga4/` in
this repo for working examples.

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
request thread). They are pure with respect to AWS — no IAM, no
network — and execute synchronously.

| Surface | Returns | Use case |
|---|---|---|
| `metadata(post, site)` | `PluginMetadata` (Next.js `Metadata`-shaped) | Per-post `<title>` / OGP / Twitter / canonical |
| `siteMetadata(site)` | `PluginMetadata` | Site-wide `<title>` / favicon / RSS `<link rel="alternate">` |
| `publicHead(ctx)` | `PublicHeadDescriptor[]` | Analytics loader, fonts, jsonld, hreflang |
| `publicBodyEnd(ctx)` | `PublicBodyDescriptor[]` | GTM no-script frame, chat widgets, tail snippets |

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
`ReactNode`. The runtime validates them, then builds the React
elements itself. This is the safety boundary that lets ampless run
untrusted code in the public render path.

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

`key` must be a relative asset key. Empty strings, absolute paths,
`.` / `..` path segments, backslashes, control characters, and keys
over 256 characters are rejected before S3 is called. Nested paths
such as `indexes/posts.json` are allowed. The return value is the
public URL for the written object.

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

---

## 14. Where to ask

- Architecture / design questions → [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md)
- Bugs in a first-party plugin → file an issue against
  `heavymoons/ampless` referencing the plugin's package name.
- Bugs in the plugin runtime / admin form → same repo, label
  `area:plugins`.

The ampless repo stays private until v1.0 RC. Once it's public, the
links above resolve to the actual GitHub URLs; today they live in
the package tarball directly under `node_modules/ampless/docs/`.
