# ampless

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

## 0.2.0-alpha.4

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

## 0.2.0-alpha.3

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

## 0.2.0-alpha.2

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

- 1238898: `create-ampless --deploy --domain <X>` now rewrites the scaffolded
  `cms.config.ts` so the admin sites list reflects the deployed domain
  from the very first build, instead of carrying the local-dev defaults
  into production:
  - `site.url` is rewritten from `'http://localhost:3000'` to
    `'https://<fullDomain>'`.
  - A `sites: { default: { domains: ['<fullDomain>'] } }` block is
    injected so the domain shows up in the admin sites list.

  Both rewrites are idempotent and only fire when the scaffold
  placeholders are still in place, so `--mount` mode against a project
  where the user already customized `cms.config.ts` is a no-op.

  To support the seeded single-entry `sites:` block without breaking
  local development (where `localhost` is not a registered domain),
  `ampless.resolveSiteId` now treats a single declared site as a
  catch-all for any host — matching what `isMultiSite` already considered
  "single-site mode". Multi-site behavior (strict host → site lookup, 404
  on unknown host) is unchanged for configurations with 2+ sites.

  Also: `create-ampless` now writes a canonical `.gitignore` into every
  scaffolded project (`node_modules/`, `.next/`, `next-env.d.ts`,
  `.amplify/`, `amplify_outputs.json`, `*.tsbuildinfo`, `.env*`,
  `.DS_Store`, editor dirs, log files). Previously the scaffold shipped
  no `.gitignore` at all, leaving fresh projects vulnerable to committing
  `node_modules` or leaking `amplify_outputs.json` (which contains live
  Cognito identity pool ids). The constant is now shared between scaffold
  and `--mount` so they can't drift; `MOUNT_DEFAULT_GITIGNORE` continues
  to re-export the same value for backward compatibility.

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

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

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
