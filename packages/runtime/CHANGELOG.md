# @ampless/runtime

## 1.0.0-alpha.15

### Patch Changes

- Updated dependencies [dbc7e43]
  - ampless@1.0.0-alpha.11
  - @ampless/plugin-og-image@0.2.0-alpha.11

## 1.0.0-alpha.14

### Minor Changes

- 52ee58a: Middleware-driven post routing + Lambda in-memory flag cache +
  per-post Cache-Control strategy. Plus the URL flatten.

  Public URLs collapse to `/<slug>` and `/<slug>/<path>` only. The
  `/_/<slug>` reserved prefix is gone. The internal file system also
  flattens: `app/site/[siteId]/...` → `app/...` (the `[siteId]`
  segment was always `'default'` after v0.2 alpha multi-site removal).

  Middleware now fetches `post.format` + `post.metadata` +
  `post.updatedAt` from AppSync (apiKey auth, single small GraphQL
  query) and rewrites the request to the right internal handler:
  - themed post → no rewrite, served by `app/[slug]/page.tsx`
  - `metadata.no_layout: true` HTML or `format: 'static'` →
    `/r/<slug>(/<path>)`, served by `app/r/[slug]/[[...path]]/route.ts`

  A 200-entry LRU with a 60-second TTL caches the flag lookup in
  Lambda module scope (Node runtime). Hot slugs cost zero AppSync
  queries for the duration of the cache window.

  `Cache-Control` is computed by middleware and set on the response:
  - `metadata.cache: 'auto'` (default) — `no-store` within
    `cms.config.cache.cooldownMs` of `updatedAt` (default 1h); then
    `public, max-age=<freshTtlSeconds>, s-maxage=<freshTtlSeconds>`
    (default 300 sec / 5 min).
  - `metadata.cache: 'deep'` — always `public, max-age=<deepTtlSeconds>,
s-maxage=<deepTtlSeconds>` (default 3600 sec / 1 hour).
  - `metadata.cache: 'hot'` — always `no-store`.

  `metadata.cache` is independent of `metadata.no_layout` and `format`
  — the same three strategies apply uniformly to themed, no_layout,
  and static posts.

  Schema change: the `PublicPost` customType in `@ampless/backend` now
  includes `updatedAt` (DynamoDB auto-managed; the JS resolvers pass
  items through verbatim, so the field becomes available once the
  schema declares it). This is an additive projection — existing data
  is unaffected, but downstream sandboxes / production deploys must
  re-`ampx deploy` to pick up the new schema.

  MCP tools: `create_post` and `update_post` schemas now advertise
  `metadata.cache` alongside `metadata.no_layout`; `get_schema.notes`
  gains `cacheStrategy` with the full contract.

  Breaking changes:
  - `createAmplessMiddleware` factory gains two required opts:
    `appsyncUrl` and `apiKey`. Template `proxy.ts` updated to pass
    these from `amplify_outputs.json` (`outputs.data.url` and
    `outputs.data.api_key`). Downstream projects must run
    `update-ampless` to pick up the new shape.
  - `/_/<slug>` no longer works. Bookmarks / external links to the
    reserved underscore namespace will 404. (v0.2 alpha — no external
    link weight to preserve.)
  - `app/site/[siteId]/` files moved to `app/` directly. Custom code
    inside the old `site/[siteId]/` subtree must be moved by hand —
    `create-ampless upgrade` cleans up the obsolete files but doesn't
    copy user-authored content out.
  - `ThemeRouteContext.params` no longer carries `siteId`. Themes that
    read `siteId` from `params` must drop the field (the value was
    always `'default'`).

### Patch Changes

- Updated dependencies [52ee58a]
  - ampless@1.0.0-alpha.10
  - @ampless/plugin-og-image@0.2.0-alpha.10

## 1.0.0-alpha.13

### Major Changes

- af1f9b0: Remove `siteId` from the AppSync data schema entirely.

  The previous multi-site drop kept the column as `'default'` for
  forward-compat. With this change, the field, identifier composite,
  GSI key composition (siteIdStatus, siteIdSlug, siteIdTag), and
  every consumer-side reference are gone.

  **Breaking — destructive for existing deployments.** Amplify will
  recreate the affected DynamoDB tables (Post, Page, Media, Taxonomy,
  PostTag) on next sandbox / production deploy because the identifier
  schema changes. **Existing post / media / page data will be lost.**
  This is acceptable in v0.2 alpha (no production users yet).

  What changed in the schema:
  - Post: identifier `[postId]`, GSI `byStatus` (status, publishedAt)
    and `bySlug` (slug)
  - Page / Media / Taxonomy: identifier dropped to just the resource
    id (`pageId` / `mediaId` / `termId`)
  - PostTag: identifier `[tag, publishedAtPostId]`
  - Custom queries (`listPublishedPosts`, `getPublishedPost`,
    `listPostsByTag`) lose their `siteId` argument
  - JS resolvers in `templates/_shared/amplify/data/*.js` rewritten to
    query without the site partition prefix

  Code-side changes:
  - `ampless` no longer exports `DEFAULT_SITE_ID`,
    `composeSiteIdStatus`, `composeSiteIdSlug` (file `sites.ts`
    removed)
  - `Post`, `Page`, `Media` types no longer carry `siteId`
  - `ToolContext.defaultSiteId` removed from the MCP tool registry —
    tools' args no longer thread a site id at all
  - `loadSiteSettings()` / `loadThemeConfig()` lose the (already
    optional) `siteId` parameter
  - Admin page factories drop the `defaultSiteId` plumbing
  - `processor-trusted` partition keys simplify from
    `${siteId}#published` to a single `published` query
  - KvStore `siteconfig` PK is now a constant (no `:siteId` suffix);
    the S3 site-settings cache moves to `public/site-settings.json`

  Migration:
  1. On the next deploy (sandbox or production), Amplify will detect
     the identifier change and recreate the tables. **Back up
     anything you care about first.** For sandbox-only data, just let
     it rebuild.
  2. Re-create your initial admin account after the redeploy if
     Cognito user data was tied to the wiped tables.

  The retained `siteId` schema column is the last piece of the
  multi-site removal that started in the previous commit on this
  branch.

### Minor Changes

- af1f9b0: Drop in-deploy multi-site support. Single Amplify deployment = single site.

  Why: Amplify Hosting's CloudFront cache key doesn't include Host, so
  multi-site mode had to force `Cache-Control: private, no-store`,
  killing edge caching for the most common (read) path. The
  operator-facing cost (deploy separately per site, which everyone was
  already doing) was lower than the perf cost. Single-site lets
  CloudFront cache work out of the box.

  Schema retains the `siteId` column on Post / Media / etc. as
  `'default'`-only — no data migration needed for existing deployments.
  A future re-introduction of multi-site (if ever) would be opt-in and
  require explicit CloudFront cache-key configuration.

  What's removed (consumer-visible):
  - `cms.config.sites: {...}` map → gone. Only `cms.config.site: {...}`
    (singular) is supported. Existing projects: remove the `sites:` block
    from `cms.config.ts`; the `site:` block is unchanged.
  - `Config.sites` and `SiteConfig` types removed from `ampless`. So are
    the `resolveSiteId`, `isMultiSite`, `siteFor` helpers.
  - `<SiteSelector>` admin UI component, `/admin/sites/` list page,
    `admin-site-client.ts` cookie helpers (`ADMIN_SITE_COOKIE`,
    `readAdminSiteIdFromCookie`, `setAdminCmsConfig`).
  - `admin.currentAdminSiteId()` / `admin.adminSiteOptions()` removed
    from the `Admin` shape.
  - `loadSiteSettings(siteId)` / `loadThemeConfig(siteId)` — `siteId` arg
    is still accepted for API stability but ignored (always `'default'`).
  - `createAmplessMiddleware` no longer reads `cmsConfig.sites` for
    host routing and no longer forces `Cache-Control: private, no-store`.
  - MCP tools: the `siteId` argument is no longer advertised in tool
    schemas (LLM clients pass post args directly). Internal default-fallback
    is retained so older clients passing `siteId` still work.

  What's NOT changing yet (deferred to follow-up PRs):
  - URL structure — internal `/site/[siteId]/` (always `default`) is
    still in the routing tree. A follow-up flattens this to `/`-rooted
    paths.
  - Cache-Control strategy — current responses are still mostly uncached.
    A follow-up introduces a cooldown-based CloudFront cache policy.

  Migration for existing deployments:
  1. Run `npm run update-ampless` to pull the new templates / `cms.config.ts`.
  2. Edit `cms.config.ts`: remove any `sites: { ... }` block. Keep
     `site: { name, url, description }` as-is.
  3. Delete obsolete shim files if present: `lib/admin-site.ts`,
     `lib/admin-site-client.ts`. The `update-ampless` cleanup pass
     removes the retired admin route at `app/(admin)/admin/sites/page.tsx`
     automatically; the `lib/` shims live outside the managed path so
     they need to be deleted by hand.
  4. `git commit && git push` to redeploy.

  Existing data (Post / Media / etc.) is unaffected — the rows already
  all have `siteId: 'default'`. The `siteId` column stays in the schema
  as a forward-compat hook.

- 16b8f09: Unify the `no_layout` HTML and static-bundle URLs under a single
  `/_/<slug>` prefix.

  Before:
  - `/raw/<slug>` — bare HTML (`format=html` + `metadata.no_layout=true`)
  - `/<slug>/<path>` — static-bundle asset (post `format=static`)
  - the post dispatcher 308-redirected to `/raw/<slug>` for no_layout
    posts and 308-redirected to `/<slug>/<entrypoint>` for static posts

  After:
  - `/_/<slug>` — single entry point for both
  - `/_/<slug>/` (trailing slash) — static-bundle entrypoint
  - `/_/<slug>/<path>` — static-bundle internal file
  - the post dispatcher 308-redirects both `metadata.no_layout` and
    `format='static'` posts to `/_/<slug>`; the new unified handler
    decides on `format` + `metadata.no_layout` and (for static) adds a
    trailing-slash 308 on the way to the presigned URL

  Wins:
  - One reserved URL namespace (`/_/`) instead of two (`/raw/` + the
    unprefixed slug-with-path pattern that previously competed with
    normal post routing).
  - Static-bundle bundles no longer collide with normal post slugs.
  - LLM-facing docs (`get_schema` notes, MCP tool descriptions) only
    have to teach one URL pattern.

  Breaking changes (deliberately not back-compat — alpha):
  - Old `/raw/<slug>` URLs return 404. No 301 redirect is emitted.
  - Old `/<slug>/<path>` static URLs also return 404. The post
    dispatcher's redirect target carries existing single-segment links
    to `/_/<slug>/` automatically; only direct deep links to internal
    bundle files would have lingered.

  Sites with deployed no_layout HTML posts or static bundles should run
  `npm run update-ampless` to pick up the new route template, then
  redeploy.

  Implementation note: Next.js's App Router excludes any path part
  starting with `_` from route discovery. The on-disk folder uses the
  literal name `r/` (`app/site/[siteId]/r/[slug]/[[...path]]/route.ts`)
  and the middleware rewrites the public `/_/` prefix to `/r/` at
  request time. The browser URL stays `/_/<slug>(/...)`.

### Patch Changes

- Updated dependencies [af1f9b0]
- Updated dependencies [af1f9b0]
  - ampless@1.0.0-alpha.9
  - @ampless/plugin-og-image@0.2.0-alpha.9

## 0.2.0-alpha.12

### Patch Changes

- Updated dependencies [e1fd2ca]
  - ampless@0.2.0-alpha.8
  - @ampless/plugin-og-image@0.2.0-alpha.8

## 0.2.0-alpha.11

### Minor Changes

- da28c62: Markdown renderer overhaul + tiptap rich extensions.

  `@ampless/runtime`: replaces the minimal hand-rolled markdown parser in `renderMarkdown` with `marked` v14 + GFM, so posts in `format: 'markdown'` now render the full set of common constructs — tables, task lists, h3–h6, links, images, blockquotes, ordered lists, italic, strikethrough, horizontal rules, autolinks. `renderTiptap`, `tiptapToMarkdown`, and `htmlToMarkdown` learn the new node types (`table`/`tableRow`/`tableHeader`/`tableCell`, `taskList`/`taskItem`) and marks (`underline`, `highlight`, `textAlign` on paragraph/heading), so admin format switches preserve more of the document. Underline/highlight fall back to `<u>`/`<mark>` HTML tags in markdown (preserved across round trips); textAlign cannot be expressed in markdown and is dropped on conversion.

  `@ampless/admin`: tiptap editor gains `Table` (resizable), `TableRow`/`TableHeader`/`TableCell`, `TaskList`/`TaskItem`, `Underline`, `Highlight`, and `TextAlign` (heading + paragraph). Toolbar adds buttons for underline, strikethrough, highlight, task list, blockquote, horizontal rule, and four text-align directions, plus a table popover with insert + row/column add/remove + header toggle + delete. Tables, task lists, marks, and resize handles get minimal scoped CSS using existing theme tokens.

## 0.2.0-alpha.10

### Patch Changes

- 1ccbeda: Consolidate AppSync `AWSJSON` encode / decode behind shared `encodeAwsJson` / `decodeAwsJson` helpers in `ampless`.

  Background: every `a.json()` field (`Post.body`, `Post.metadata`, `Page.body`, `KvStore.value`, …) carries a _JSON-encoded string_ on the wire, regardless of whether the underlying value is a string, object, or array. That rule held in five different ad-hoc implementations across `admin`, `runtime`, `mcp-server`, and `backend` — until the `mcp-server` copy diverged, returning string bodies verbatim and tripping AppSync's `Variable 'body' has an invalid value.` validator on markdown / html posts (already patched in the prior fix).

  Now there is one implementation and one set of tests in [`packages/ampless/src/awsjson.ts`](packages/ampless/src/awsjson.ts). Callers across the monorepo import it — no more drift.

  No behavior change for callers that were already correct; the encode path is now uniformly `JSON.stringify(value ?? null)` and the decode path tolerates both wire shapes (string and the DynamoDB-unmarshalled native value).

- Updated dependencies [1ccbeda]
  - ampless@0.2.0-alpha.7
  - @ampless/plugin-og-image@0.2.0-alpha.7

## 0.2.0-alpha.9

### Patch Changes

- de57606: Bilingual `.md` / `.ja.md` README convention across all published packages.

  Every package README now has a Japanese counterpart at `README.ja.md`,
  with a language-toggle header at the top of the English version
  linking to it.

  `create-ampless` additionally bundles the bilingual versions of every
  template README (per-theme + `RUNBOOK.md`) so scaffolded projects
  ship with both languages. The per-theme READMEs themselves have been
  rewritten to focus purely on the theme's content and customization
  fields, dropping generic ampless project-setup instructions that
  belonged in the project README / RUNBOOK rather than inside a theme
  directory.

  No runtime behavior changes.

- Updated dependencies [de57606]
  - @ampless/plugin-og-image@0.2.0-alpha.6
  - ampless@0.2.0-alpha.6

## 0.2.0-alpha.8

### Patch Changes

- Updated dependencies [ddbffbf]
  - ampless@0.2.0-alpha.5
  - @ampless/plugin-og-image@0.2.0-alpha.5

## 0.2.0-alpha.7

### Minor Changes

- bb6c2ae: Three follow-ups to the dark / light theme support shipped earlier:
  1. **Custom colour overrides accept a light / dark pair.** Every color
     field on the theme settings page now has an opt-in "Add dark
     variant" toggle. When set, the value is stored as
     `light-dark(L, D)`, which the runtime pastes verbatim into the
     inline `:root { --foo: ... }` override — the browser then picks
     between the two per active `color-scheme`. Stored value parsing
     and validation handle both single-form (existing) and pair-form
     (new); the validator splits on the top-level comma so nested
     `rgb(r, g, b)` / `hsl(...)` commas don't trip it.
  2. **Colour picker now starts on the current value.** The previous
     canvas-based hex round-trip relied on `ctx.fillStyle` parsing,
     which silently kept the reset value when oklch parsing failed on
     some browsers — surfacing as a picker stuck on black. The new
     `useColorAsHex` initialises from `#rrggbb` synchronously and then
     resolves any non-hex form via `getComputedStyle` in `useEffect`,
     so the swatch always reflects the saved colour after mount.
  3. **Iframe preview now reflects the unsaved colour-scheme.**
     Middleware forwards `?previewColorScheme=<mode>` as the
     `x-preview-color-scheme` header; the root layout uses it to
     override the saved `theme.colorScheme` for the duration of that
     request. The admin form's iframe `key` and `src` now include the
     pending colorScheme so changing the select live-updates the
     preview.

  `ampless` exports `parseColorPair` and `formatColorPair` helpers.

### Patch Changes

- Updated dependencies [bb6c2ae]
  - ampless@0.2.0-alpha.4
  - @ampless/plugin-og-image@0.2.0-alpha.4

## 0.2.0-alpha.6

### Minor Changes

- 24a731b: Dark / light theme support with a per-site override.

  Every shipped theme already carried a dark palette via
  `@media (prefers-color-scheme: dark)` blocks in `tokens.css`, but a site
  admin had no way to override the visitor's system preference. The
  rewrite turns the dark variant into a first-class part of every theme
  and adds a per-site setting.

  **What changes**
  - **`tokens.css` (all 6 themes + globals defaults)**: rewritten to use
    the CSS `light-dark(L, D)` function. A single declaration covers
    both modes; the active `color-scheme` selects which value is
    rendered. `@media (prefers-color-scheme: dark)` blocks are removed
    (≈half the file size per theme).
  - **`@ampless/runtime`**: `EffectiveThemeConfig` gains a
    `colorScheme: 'auto' | 'light' | 'dark'` field, validated against
    the site's stored override (`theme.colorScheme` in KvStore).
    Exports `ColorScheme`, `validateColorScheme`,
    `DEFAULT_COLOR_SCHEME`, and `COLOR_SCHEME_SETTING_KEY` for
    consumers.
  - **Template `app/layout.tsx`**: writes `data-color-scheme` on
    `<html>` when the site has pinned `'light'` or `'dark'`. Omits the
    attribute for `'auto'` so the document inherits the
    `:root { color-scheme: light dark; }` default and the visitor's
    `prefers-color-scheme` wins.
  - **Template `app/globals.css`**: adds the `:root` /
    `html[data-color-scheme=…]` opt-in block; default tokens converted
    to `light-dark()` so admin / non-theme pages also adapt.
  - **`@ampless/admin`** theme settings page: new "Color scheme" select
    ("Auto / Light only / Dark only") above the per-theme manifest
    fields. Saves through the same KvStore path; selecting "Auto"
    deletes the override.

  **Compatibility note: `light-dark()` requires browsers from 2024 or
  later** (Baseline). Older browsers render only the light value, which
  is acceptable for ampless's target.

## 0.2.0-alpha.5

### Minor Changes

- dbf0fb0: Add `format: 'static'` for ZIP / file-bundle landing pages.

  A "static" post is a directory of HTML / CSS / JS / image assets uploaded as a zip (or as loose files via the directory picker). The bundle is extracted into `public/static/<siteId>/<slug>/` in S3 and served verbatim by a new catch-all route handler at `app/site/[siteId]/[...path]/route.ts` — no theme chrome, no rewriting, just S3 → presigned URL → 302 redirect.

  **Hard constraint enforced at upload time**: every reference inside the bundle (HTML `src`/`href`/`srcset`, CSS `url()`/`@import`) must be **relative**. Absolute paths (`/foo`) and protocol-relative URLs (`//cdn.example/foo`) are flagged by the admin uploader before save. The constraint keeps the bundle portable — exactly the same files work whether you preview locally by opening `index.html` or deploy under any URL prefix. JS string paths aren't validated (too dynamic to verify); authors are responsible for keeping them relative too.

  Pieces:
  - `ContentFormat` gains `'static'`; the schema enum is widened (`Post.format` and `Page.format`).
  - New `StaticPostBody` interface (`entrypoint`, `files[]`, `uploadedAt`) — the body column is now the bundle's manifest; the actual bytes live in S3.
  - `@ampless/admin` ships `StaticUploader` (zip via JSZip, or loose-file directory picker). The component runs path validation + cross-file lint on extract and blocks save until issues are fixed. Switching format away from `static` in `PostForm` clears the pending bundle.
  - New `@ampless/runtime/routes#createStaticRouteHandler` factory. It looks up the post by slug, refuses non-static formats (defense in depth for direct `/raw-ish` URLs), and 302s to a 1-hour presigned URL via Amplify SSR.
  - Theme post dispatcher (`createThemePostDispatcher`) detects `format === 'static'` and 308-redirects to `/<slug>/<entrypoint>` so the URL ends in a real filename — that's what makes the browser resolve relative paths in the bundle under `/<slug>/…` instead of the site root.
  - `templates/_shared/app/site/[siteId]/[...path]/route.ts` is the wiring template projects ship.
  - Bundle delete cleans up the S3 prefix on post deletion or re-upload so removed files don't linger.

  Limitations:
  - Browser-side upload is capped at ~50 MB uncompressed. Larger bundles should land via direct S3 upload + admin-side metadata edit (out of scope for v1).
  - Slug name collisions matter: `og`, `raw`, `tag`, `feed.xml`, `sitemap.xml` are taken by other route handlers, so a static post can't use those as its slug.

### Patch Changes

- Updated dependencies [dbf0fb0]
  - ampless@0.2.0-alpha.3
  - @ampless/plugin-og-image@0.2.0-alpha.3

## 0.2.0-alpha.4

### Minor Changes

- 0f47d6e: Replace the `.html` slug-suffix convention for bare-HTML rendering with a data-driven `metadata.no_layout` toggle.

  `Post` gains a free-form `metadata` JSON column (DynamoDB `a.json()` + `PublicPost` customType + `PostMetadata` TS interface in `ampless`). The well-known key `no_layout: boolean` tells the runtime to serve the post as bare HTML (no theme chrome, no Next.js root layout). Other keys are passed through unchanged for plugin / app use.

  Behavioural changes:
  - **Middleware**: the `/(slug).html → /raw/(slug).html` rewrite is gone. Slugs ending in `.html` are now treated as ordinary post URLs. The slug-suffix shortcut never carried real semantics (middleware can't see post fields), so the data column is now the only source of truth.
  - **Theme post dispatcher**: peeks at `post.metadata.no_layout` before delegating. When true, redirects to `/raw/<slug>` so the raw route handler can emit the body directly (the browser URL settles on `/raw/<slug>`).
  - **Raw route handler**: also enforces `metadata.no_layout === true` and 404s otherwise. A direct `/raw/<slug>` request for a normal post no longer leaks the body without theme chrome.
  - **Admin post form**: adds a "no layout" checkbox that writes `metadata.no_layout`. The checkbox merges into existing metadata (plugin state etc. is preserved on save).

  Migration for posts published before this release: rename the slug (drop `.html`) and tick the new "no layout" checkbox in the admin. The old URL `/promo.html` will no longer auto-route to the raw handler — set the metadata flag and the post lives at `/raw/promo` instead.

### Patch Changes

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2
  - @ampless/plugin-og-image@0.2.0-alpha.2

## 0.2.0-alpha.3

### Patch Changes

- 55734e5: Fix `next build` type error on scaffolded thin-shell page files:

  ```
  Type 'ThemePostDispatcher' is not assignable to type 'FunctionComponent<any>'.
  Type 'Promise<unknown>' is not assignable to type 'Promise<AwaitedReactNode>'.
  ```

  The L1 extraction typed the three theme dispatcher return values as `Promise<unknown>` to avoid pulling React into ampless core. But `next build` (Next.js 16's stricter type-check pass) rejects this at the App Router page-default-export site.

  Narrow the dispatchers' return type to `Promise<React.ReactNode>` via the `react` peer dep. Runtime semantics unchanged; the returned value already is a server component render result.

  Surfaced via Amplify Hosting build for the dogfood site `ampless.heavymoons.net`.

## 0.2.0-alpha.2

### Patch Changes

- da08397: Inline the proxy matcher config in scaffolded `proxy.ts`. Next.js 16's Turbopack requires `export const config` in middleware/proxy files to be a statically analysable object literal — referencing an imported variable (like `defaultMatcherConfig` from `@ampless/runtime/middleware`) fails the build:

  ```
  Next.js can't recognize the exported `config` field in route.
  It needs to be a static object.
  ```

  Drop the re-export pattern and inline the matcher array in the scaffold. `defaultMatcherConfig` stays exported from `@ampless/runtime/middleware` as a documentation reference (with a JSDoc note explaining the Turbopack constraint), but isn't used by the scaffold anymore.

  Existing scaffolds need to edit their `proxy.ts` (or `middleware.ts`) to inline `config = { matcher: [...] }` directly.

## 0.2.0-alpha.1

### Patch Changes

- 9f6adad: Bump all direct dependencies to latest majors so the alpha track isn't carrying a major version behind. Notable bumps:
  - `typescript` 5.9 → 6.0
  - `next` 15 → 16 (Amplify adapter-nextjs peer allows up to <17)
  - `@tiptap/*` 2.27 → 3.23 — editor API migration (BubbleMenu moved to `@tiptap/react/menus`, `tippyOptions` → `options` for Floating-UI)
  - `vitest` 2 → 4
  - `eslint` 9 → 10
  - `lucide-react` 0.469 → 1.16
  - `tailwind-merge` 2 → 3
  - `@jsquash/avif` 1 → 2
  - `@clack/prompts` 0.9 → 1.4
  - plus all minor / patch refreshes (turbo, @aws-sdk, changesets, @types/node, typescript-eslint, vite)

  Behavioural code changes:
  - `theme-actions.ts`: `revalidateTag` → `updateTag` (Next 16's read-your-own-writes variant for Server Actions)
  - `image-bubble-menu.tsx`: tiptap 3 import path + Floating-UI option shape
  - TS 6 strict-mode fixes (catch params, side-effect css import declaration)

- Updated dependencies [9f6adad]
  - ampless@0.2.0-alpha.1
  - @ampless/plugin-og-image@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0
  - @ampless/plugin-og-image@0.2.0-alpha.0
