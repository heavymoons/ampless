# @ampless/mcp-server

## 1.0.0-alpha.11

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

## 1.0.0-alpha.10

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

### Patch Changes

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

- Updated dependencies [af1f9b0]
- Updated dependencies [af1f9b0]
  - ampless@1.0.0-alpha.9

## 0.2.0-alpha.9

### Minor Changes

- e1fd2ca: MCP static-format post support (4 new tools).

  `upload_static_bundle` (zip-based, one-shot), `upload_static_file` /
  `delete_static_file` (incremental per-file ops), `commit_static_post`
  (rebuild the Post manifest from the current S3 prefix).

  Refactor: `mimeTypeFor`, `validateBundlePath`, `findAbsolutePathRefs`,
  `validateBundle`, `bundlePrefix`, `pickDefaultEntrypoint`,
  `stripCommonPrefix` moved from `@ampless/admin/lib/static-bundle` to
  `ampless` core so the MCP tools (running in both the stdio CLI and
  the Lambda HTTP transport) can reuse the validation. Admin re-exports
  the moved helpers, no behaviour change for the existing browser
  uploader.

  StorageClient interface (`@ampless/mcp-server/tools`) gains
  `deleteObject` and `listObjects`. The stdio CLI's S3 client and the
  HTTP transport's S3 client both implement them with the new AWS SDK
  commands (`DeleteObjectCommand`, `ListObjectsV2Command`).

  IAM: mcp-handler Lambda role gets `s3:PutObject` / `s3:DeleteObject`
  on `public/static/*` and `s3:ListBucket` with a prefix condition for
  the same path. Static asset writes were not previously reachable
  from MCP — the Phase 5 grant only covered `public/media/*`.

  `format: 'static'` is intentionally NOT added to the generic
  `create_post` / `update_post` enums. The bundle tools are the only
  supported entry point; mixing generic post mutations would let
  callers create posts whose `body` manifest doesn't match the S3
  prefix.

  Deferred:
  - Page model static support (Post-only for now)
  - `delete_static_post` cleanup tool
  - Per-file uploads larger than the Lambda payload cap (~4 MB binary
    after base64). Use `upload_static_bundle` for whole-bundle workflows
    that fit, or the admin StaticUploader for anything over ~5 MB.

### Patch Changes

- Updated dependencies [e1fd2ca]
  - ampless@0.2.0-alpha.8

## 0.2.0-alpha.8

### Minor Changes

- 76abf3d: Expose `metadata` (with the `no_layout` well-known key) on the MCP
  post tools.

  The Post model has carried a free-form `metadata` JSON column since
  v0.1, and the runtime treats `metadata.no_layout = true` (in
  combination with `format: 'html'`) as "serve this post as a bare
  HTML page — the public route 302-redirects to `/raw/<slug>` and
  renders the body verbatim with no theme chrome". But the MCP tool
  schemas hid both: `create_post` / `update_post` had no `metadata`
  field at all, and `get_schema` didn't mention the well-known keys.
  LLM clients had no way to publish a no-layout HTML page through the
  HTTP MCP transport.

  What's added:
  - `create_post` / `update_post` schemas gain an optional
    `metadata` object property. `no_layout` is broken out as a typed
    sub-property with a description; other keys pass through via
    `additionalProperties: true` for themes / plugins.
  - Tool descriptions in `tools/index.ts` now spell out the
    `metadata: { no_layout: true }` recipe for `create_post` and
    warn that `update_post`'s `metadata` is a full replace.
  - `get_schema` reports `metadata` as a post field, with a new
    `notes.noLayout` entry explaining the route behaviour and a
    `notes.staticFormat` entry documenting that the underlying
    `static` format exists but its asset upload flow is admin-UI
    only (the MCP `upload_media` tool writes to `public/media/`
    not `public/static/`).
  - `POST_FIELDS` GraphQL fragment now selects `metadata`, and
    `toCorePost` round-trips it through the same AWSJSON decoder
    used for `body` — handles both the JSON-string and
    native-object shapes Amplify stores depending on the resolver
    path.

  What's intentionally NOT added in this PR:
  - `format: 'static'` is still excluded from the tool enums. The
    bundle upload story needs `s3:PutObject` scoped to
    `public/static/*` plus a separate `upload_static_bundle` tool;
    documented under `notes.staticFormat` as deferred.

## 0.2.0-alpha.7

### Patch Changes

- 1ccbeda: Consolidate AppSync `AWSJSON` encode / decode behind shared `encodeAwsJson` / `decodeAwsJson` helpers in `ampless`.

  Background: every `a.json()` field (`Post.body`, `Post.metadata`, `Page.body`, `KvStore.value`, …) carries a _JSON-encoded string_ on the wire, regardless of whether the underlying value is a string, object, or array. That rule held in five different ad-hoc implementations across `admin`, `runtime`, `mcp-server`, and `backend` — until the `mcp-server` copy diverged, returning string bodies verbatim and tripping AppSync's `Variable 'body' has an invalid value.` validator on markdown / html posts (already patched in the prior fix).

  Now there is one implementation and one set of tests in [`packages/ampless/src/awsjson.ts`](packages/ampless/src/awsjson.ts). Callers across the monorepo import it — no more drift.

  No behavior change for callers that were already correct; the encode path is now uniformly `JSON.stringify(value ?? null)` and the decode path tolerates both wire shapes (string and the DynamoDB-unmarshalled native value).

- c87773b: Fix `create_post` / `update_post` failing with **"Variable 'body' has an invalid value."** for markdown / html posts.

  `encodeBody` in `mcp-server` returned string values verbatim, so a raw markdown body like `# Hello` was sent to AppSync as a bare string. AppSync's `AWSJSON` scalar rejects that — it requires a JSON-encoded string on the wire (`"# Hello"`, a JSON string literal). tiptap posts happened to work because their object body was always `JSON.stringify`d through the structural branch.

  Always `JSON.stringify` regardless of input type, matching the admin posts-provider's existing rule. The `decodeBody` round-trip is unchanged: `JSON.parse('"# Hello"')` → `'# Hello'`.

  `@ampless/backend` patches alongside because its `dist/functions/mcp-handler.js` bundles the fixed `mcp-server` tools.

- Updated dependencies [1ccbeda]
  - ampless@0.2.0-alpha.7

## 0.2.0-alpha.6

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
  - ampless@0.2.0-alpha.6

## 0.2.0-alpha.5

### Minor Changes

- ddbffbf: MCP HTTP transport + per-site access tokens.

  Previously the only way to use the MCP server was to run
  `@ampless/mcp-server` locally with the consumer's
  `amplify_outputs.json` on disk. That made it practical only for the
  sandbox backend; for the production site you'd have to download the
  deployed `amplify_outputs.json`, which leaks credentials and doesn't
  scale.

  Now every ampless site exposes an HTTP MCP endpoint at `/api/mcp` on
  its own domain (`https://<your-domain>/api/mcp`). MCP clients
  (Claude Desktop / Cursor / Claude Code) connect over HTTPS with a
  Bearer token issued from `/admin/mcp-tokens`.

  **What's new**
  - **`@ampless/mcp-server/tools` sub-export** — the existing tool
    handlers are reusable from the HTTP route. Tool files import
    abstract `GraphqlClient` / `StorageClient` interfaces from
    `./types.js` (no SDK deps), so consumers plug in their own clients.
  - **`@ampless/admin/api/mcp`** — `createMcpRoute(admin)` returns a
    Next.js `POST` handler that authenticates Bearer tokens against
    KvStore, dispatches `tools/list` / `tools/call` JSON-RPC over a
    service Cognito user's id token.
  - **`@ampless/admin/api/mcp-tokens`** — `createMcpTokensRoute(admin)`
    exposes admin-only CRUD over the tokens (`GET` list / `POST` create
    / `DELETE` revoke). Plaintext returned exactly once at issuance;
    storage is SHA-256-hashed.
  - **`@ampless/admin/pages` → `createMcpTokensPage`** — admin UI at
    `/admin/mcp-tokens` with a create-and-copy modal, list with
    last-used timestamps, and revoke per row.
  - **Template scaffolding** adds the three route shells and the
    sidebar nav link. Existing projects pick them up via
    `npm run update-ampless`.
  - **`ampless` exports `getKvStore`** so non-site-settings KvStore
    callers (the token store) don't need to redefine the global.

  **One-time setup per site**

  See `docs/mcp-http-setup.md` for the full flow. Summary:
  1. Create a dedicated Cognito user via `/admin/users` (admin role).
  2. Set `AMPLESS_MCP_SERVICE_EMAIL` / `AMPLESS_MCP_SERVICE_PASSWORD` as
     Amplify Hosting environment variables.
  3. Redeploy.
  4. `/admin/mcp-tokens` → issue a token → drop it into the MCP client
     config alongside the site URL.

  **Out of scope for v0.x**
  - `upload_media` over HTTP — SSR Lambda lacks direct `s3:PutObject`
    IAM on the media bucket. Upload via the admin UI for now; the
    stdio CLI still supports it for local / sandbox use.
  - Auto-provisioning the service Cognito user (manual + documented).
  - Per-token rate limiting (Bearer revocation + KvStore lookup is the
    only enforcement).

  The existing stdio CLI (`npx -y @ampless/mcp-server@alpha`) keeps
  working unchanged — handy for sandbox / local development where you
  already have `amplify_outputs.json` on disk.

### Patch Changes

- Updated dependencies [ddbffbf]
  - ampless@0.2.0-alpha.5

## 0.2.0-alpha.4

### Patch Changes

- Updated dependencies [bb6c2ae]
  - ampless@0.2.0-alpha.4

## 0.2.0-alpha.3

### Patch Changes

- Updated dependencies [dbf0fb0]
  - ampless@0.2.0-alpha.3

## 0.2.0-alpha.2

### Patch Changes

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2

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

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0

## 0.1.0

### Minor Changes

- v0.1.0 — initial public MVP release.
  - `create-ampless` CLI: scaffolds a Next.js 15 (App Router) blog with the
    Amplify Gen 2 backend definitions baked in.
  - `ampless` core library: shared types, plugin contract (`definePlugin`,
    hooks, `PluginRuntimeContext`), event types, and helpers (`escapeXml`,
    `formatPublicAssetUrl`, `formatDate`, `processImage`, `defineSchema`,
    `defineConfig`).
  - `@ampless/plugin-seo`: OGP / Twitter / canonical metadata for posts and
    the site, plus a `sitemap.xml` regenerated to S3 on every content event.
  - `@ampless/plugin-rss`: RSS 2.0 `/feed.xml` regenerated to S3 on every
    content event, with `<language>` tag and per-call options.
  - `@ampless/plugin-webhook`: POST event payloads to external URLs with
    optional HMAC-SHA-256 signing.
  - `@ampless/mcp-server`: stdio MCP server (Claude Desktop / Cursor /
    Claude Code) exposing 7 tools — list / get / create / update / delete
    posts, upload media, get schema. Authenticates as a Cognito user via
    SRP, so each tool runs with that user's role.
  - Trust-level event system: DynamoDB Streams → event-dispatcher Lambda →
    trusted / untrusted SQS queues → trust-level processor Lambdas. Plugin
    hooks fire in the matching trust level.
  - AppSync API key auto-renewal Lambda runs monthly (EventBridge Rule), so
    the public read path never silently 401s on key expiry.

### Patch Changes

- Updated dependencies
  - ampless@0.1.0
