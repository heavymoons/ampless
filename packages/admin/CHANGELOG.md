# @ampless/admin

## 0.2.0-alpha.24

### Patch Changes

- Updated dependencies [76abf3d]
  - @ampless/mcp-server@0.2.0-alpha.8

## 0.2.0-alpha.23

### Minor Changes

- da28c62: Markdown renderer overhaul + tiptap rich extensions.

  `@ampless/runtime`: replaces the minimal hand-rolled markdown parser in `renderMarkdown` with `marked` v14 + GFM, so posts in `format: 'markdown'` now render the full set of common constructs — tables, task lists, h3–h6, links, images, blockquotes, ordered lists, italic, strikethrough, horizontal rules, autolinks. `renderTiptap`, `tiptapToMarkdown`, and `htmlToMarkdown` learn the new node types (`table`/`tableRow`/`tableHeader`/`tableCell`, `taskList`/`taskItem`) and marks (`underline`, `highlight`, `textAlign` on paragraph/heading), so admin format switches preserve more of the document. Underline/highlight fall back to `<u>`/`<mark>` HTML tags in markdown (preserved across round trips); textAlign cannot be expressed in markdown and is dropped on conversion.

  `@ampless/admin`: tiptap editor gains `Table` (resizable), `TableRow`/`TableHeader`/`TableCell`, `TaskList`/`TaskItem`, `Underline`, `Highlight`, and `TextAlign` (heading + paragraph). Toolbar adds buttons for underline, strikethrough, highlight, task list, blockquote, horizontal rule, and four text-align directions, plus a table popover with insert + row/column add/remove + header toggle + delete. Tables, task lists, marks, and resize handles get minimal scoped CSS using existing theme tokens.

### Patch Changes

- Updated dependencies [da28c62]
  - @ampless/runtime@0.2.0-alpha.11

## 0.2.0-alpha.22

### Patch Changes

- 1ccbeda: Consolidate AppSync `AWSJSON` encode / decode behind shared `encodeAwsJson` / `decodeAwsJson` helpers in `ampless`.

  Background: every `a.json()` field (`Post.body`, `Post.metadata`, `Page.body`, `KvStore.value`, …) carries a _JSON-encoded string_ on the wire, regardless of whether the underlying value is a string, object, or array. That rule held in five different ad-hoc implementations across `admin`, `runtime`, `mcp-server`, and `backend` — until the `mcp-server` copy diverged, returning string bodies verbatim and tripping AppSync's `Variable 'body' has an invalid value.` validator on markdown / html posts (already patched in the prior fix).

  Now there is one implementation and one set of tests in [`packages/ampless/src/awsjson.ts`](packages/ampless/src/awsjson.ts). Callers across the monorepo import it — no more drift.

  No behavior change for callers that were already correct; the encode path is now uniformly `JSON.stringify(value ?? null)` and the decode path tolerates both wire shapes (string and the DynamoDB-unmarshalled native value).

- Updated dependencies [1ccbeda]
- Updated dependencies [c87773b]
  - ampless@0.2.0-alpha.7
  - @ampless/mcp-server@0.2.0-alpha.7
  - @ampless/runtime@0.2.0-alpha.10

## 0.2.0-alpha.21

### Patch Changes

- a81b605: Fix the admin sidebar mobile drawer letting page content bleed through. The drawer shared `bg-muted/30` with the desktop persistent rail, but on mobile the drawer overlays the content area — at 30% opacity the post list / editor showed through and made nav items hard to read.

  Use `bg-background` (opaque) on small screens; keep `md:bg-muted/30` so the desktop rail retains its subtle tint where there's no content behind it.

## 0.2.0-alpha.20

### Patch Changes

- 949e6eb: Fix `Unknown encoding: base64url` error when issuing an MCP token from
  the admin UI.

  `generateToken()` runs in the browser (the create-token modal in
  `/admin/mcp-tokens`), where Next.js polyfills `node:crypto` via a
  Buffer shim that doesn't recognise the `base64url` encoding name —
  `Buffer.toString('base64url')` throws even though Node itself supports
  it natively. Token creation died on the very first call.

  Fix: encode as plain `base64`, then translate to the URL-safe alphabet
  by hand (`+` → `-`, `/` → `_`, strip trailing `=`). Byte-identical
  output to Node's native `base64url`, works in both runtimes. Added a
  URL-safe-only character regression test against the public token API
  so future refactors don't reintroduce the issue.

## 0.2.0-alpha.19

### Minor Changes

- c389330: v0.2 MCP HTTP transport — Phase 1 (storage layer).

  Add the foundation for the replacement HTTP MCP transport that the
  previous PR removed: API key generation, hashing, and KvStore-backed
  CRUD for token metadata.

  New exports from `@ampless/admin/lib`:
  - `mcp-token-format.ts` — `generateToken()` produces an `amk_<32-bytes-base64url>`
    plaintext token plus its SHA-256 hash for storage. `hashToken(plain)`
    validates incoming Bearer tokens against the stored hash.
  - `mcp-token-storage.ts` — `listTokens`, `findByHash`, `createToken`,
    `revokeToken`, `touchLastUsed` over `getKvStore()` with PK
    `mcp-tokens`. Revocation is a soft delete (`revokedAt` timestamp)
    for audit.

  No routes / UI / Lambda yet — those come in Phase 2 (dedicated
  `mcp-handler` Lambda Function with IAM-scoped AppSync access, admin
  UI for token CRUD via the Lambda). Phase 1 is storage-agnostic on
  purpose so it can be reused from both the SSR route (when a server
  KvStore provider is available) and the Lambda data path (where the
  provider authenticates via IAM/SigV4).

- 0a68c2e: feat(admin): MCP token management UI (Phase 2 — client-side only)

  Add `createMcpTokensPage` page factory and `McpTokensView` component for
  issuing and revoking MCP API tokens directly from the admin UI.

  The view is fully client-side: it calls the Phase 1 `listTokens`,
  `createToken`, and `revokeToken` storage functions via the existing
  `installAdminKvProvider` (user-pool-auth AppSync path). No server routes,
  no service Cognito user, no new env vars required.

  The create modal lets the admin choose a site scope and optional
  expiration (never / 30 days / 90 days / custom date). On success a
  one-time token reveal modal is shown; the plain token is never persisted.

  A yellow banner reminds admins that tokens are inert until the v0.2 HTTP
  MCP transport ships (Phase 3).

  Changes:
  - `packages/admin/src/components/mcp-tokens-view.tsx` — UI component
  - `packages/admin/src/pages/mcp-tokens.tsx` — page factory
  - `packages/admin/src/pages/index.ts` — export `createMcpTokensPage`
  - `packages/admin/src/components/sidebar.tsx` — add MCP tokens nav item
  - `packages/admin/src/locales/{en,ja}.json` — i18n strings
  - `templates/_shared/app/(admin)/admin/mcp-tokens/page.tsx` — scaffold shell

- 6b83143: Remove the unreleased HTTP MCP transport.

  The previous design required setting `AMPLESS_MCP_SERVICE_EMAIL` /
  `AMPLESS_MCP_SERVICE_PASSWORD` as Amplify Hosting environment
  variables and provisioning a dedicated Cognito user via the admin
  UI — unusable for non-technical operators. The original
  `mcp-http-transport` changeset was still pending and never shipped
  to a normal release, so we're taking it down cleanly before any
  non-alpha release picks it up.

  Removed exports from `@ampless/admin`:
  - `createMcpRoute` (`/api/mcp` handler factory)
  - `createMcpTokensRoute` (`/api/admin/mcp-tokens` CRUD handler factory)
  - `createMcpTokensPage` (`/admin/mcp-tokens` page factory)
  - `installServerKvProvider` (server-side KvStore provider that wrapped
    the now-removed Cognito-service-user auth)

  A replacement using API keys + a dedicated Lambda function with
  proper IAM scoping is planned for v0.2.

  The local stdio MCP (`@ampless/mcp-server` with
  `AMPLESS_MCP_EMAIL` / `AMPLESS_MCP_PASSWORD`) is unaffected and
  remains the recommended path for individual developers.

### Patch Changes

- 5b4a6a8: v0.2 MCP HTTP transport — Phase 3 (Lambda + Bearer validation).

  Add a dedicated `mcp-handler` Lambda exposed via a Function URL. The
  handler validates the `Authorization: Bearer amk_...` token against
  the KvStore table directly (PK `mcp-tokens`, SK SHA-256 hash) using
  its own IAM-scoped role — no Cognito identity involved.

  Phase 3 only handles authentication. The body is a stub (200 OK with
  `{ ok, tokenPrefix, scope }` on valid auth, 401 with a discriminated
  error code on missing/invalid/revoked/expired token). The MCP
  JSON-RPC envelope and tool dispatch land in Phase 4, when AppSync
  IAM auth gets wired up so the handler can read posts / write media.

  The Function URL is published as a backend output (`custom.mcp.endpoint`
  in `amplify_outputs.json`) so the admin UI and external MCP clients
  can discover the endpoint. The `/admin/mcp-tokens` page now surfaces
  the URL with a copy-to-clipboard button alongside the issued tokens;
  the inert banner has been updated to describe the new state (tokens
  validate, but tool dispatch is still Phase 4).

  Template scaffolding adds the new function shell at
  `amplify/functions/mcp-handler/`. Existing projects pick it up via
  `npm run update-ampless`.

## 0.2.0-alpha.18

### Patch Changes

- 8f6220c: Fix `/admin/mcp-tokens` and `/api/mcp` failing on deployed sites with **"No KvStore configured. Call setKvStore() during initialization."**.

  The existing `installAdminKvProvider` lives in a `'use client'` module, so it only runs in browser sessions of the admin UI. The new MCP HTTP route and MCP token CRUD API run server-side in the SSR Lambda, where the global KvStore was never installed — both blew up on first DynamoDB-backed call.

  Add `installServerKvProvider(outputs)` that wires a KvStore implementation talking straight to AppSync over `fetch` using the MCP service user's Cognito id token (the identity `/api/mcp` already uses). Call it at factory time from both `createMcpRoute` and `createMcpTokensRoute`. Route-level auth (admin cookie session for token CRUD, Bearer token for MCP) gates WHO can issue Kv ops; the underlying write identity is always the service user.

  The `data.url` and env-var checks stay lazy so a missing AppSync endpoint surfaces as a clear runtime error on the first Kv call rather than crashing the route module at import.

## 0.2.0-alpha.17

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
  - @ampless/mcp-server@0.2.0-alpha.6
  - @ampless/runtime@0.2.0-alpha.9
  - ampless@0.2.0-alpha.6

## 0.2.0-alpha.16

### Patch Changes

- 2f7dee4: Add structured per-token audit logging to `/api/mcp`.

  AppSync and S3 audit logs (CloudTrail) show every MCP-driven call as
  the shared service Cognito user — the AWS layer can't distinguish
  which Bearer token triggered which operation. The SSR Lambda's own
  CloudWatch Logs are the only place per-token attribution survives, so
  the HTTP route now emits one-line JSON events at every meaningful
  transition:

  `mcp.auth_failed` (missing / malformed / revoked Bearer token),
  `mcp.tool_call` (start, with token label + role + tool name + arg
  keys), `mcp.tool_ok` / `mcp.tool_failed` (end, with `durationMs`),
  plus `mcp.tool_unsupported` / `mcp.role_denied` / `mcp.tool_unknown`
  for the rejection branches.

  Plaintext tokens are never logged — only a 12-character
  `tokenHashPrefix` for forensic search. Argument **keys** are logged
  but not their **values**, so post bodies, PII, or other sensitive
  payloads don't leak into CloudWatch indefinitely.

  A CloudWatch Logs Insights starter query lives in
  `docs/mcp-http-setup.md`.

## 0.2.0-alpha.15

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
  - @ampless/mcp-server@0.2.0-alpha.5
  - ampless@0.2.0-alpha.5
  - @ampless/runtime@0.2.0-alpha.8

## 0.2.0-alpha.14

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
  - @ampless/runtime@0.2.0-alpha.7

## 0.2.0-alpha.13

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

### Patch Changes

- Updated dependencies [24a731b]
  - @ampless/runtime@0.2.0-alpha.6

## 0.2.0-alpha.12

### Minor Changes

- a4e30de: `/admin/sites/<id>` and `/admin/sites/<id>/theme` were 500-ing on every
  deployed scaffold with the error

  > [@ampless/admin] createAdmin was called without an `ampless` runtime
  > instance, but a method that needs one (loadSiteSettings /
  > loadThemeConfig) was invoked.

  …because the scaffolded `lib/admin.ts` intentionally omitted `ampless`
  to avoid a static-import cycle
  (`lib/admin.ts → lib/ampless.ts → themes-registry → themes →
lib/i18n.ts → lib/admin.ts`) that TDZ-throws on `ampless` at module
  init. The comment said `createAdmin` would build its own internal
  Ampless when the option is omitted, but it doesn't — the methods just
  throw at request time.

  Fix in two parts:
  1. **`@ampless/admin`**: `CreateAdminOpts.ampless` now also accepts a
     thunk: `Ampless | (() => Ampless | Promise<Ampless>)`. The thunk is
     invoked lazily on the first `loadSiteSettings` / `loadThemeConfig`
     call and the resolved instance is cached. When the thunk form is
     used, `admin.ampless` is exposed as `null` (no synchronous access
     path) — call `admin.loadSiteSettings()` etc. instead.
  2. **Template `lib/admin.ts`**: switch to the thunk form using a
     dynamic `import()` so no static import of `./ampless` is emitted.
     `lib/ampless.ts` only loads on the first sites/theme settings call
     (request time), well after every module has finished initialising,
     so the TDZ cycle never triggers.

## 0.2.0-alpha.11

### Patch Changes

- eaed85a: Move all admin-only page view bodies (`AdminDashboard`, `LoginPage`,
  `MediaPage`, `EditPostPage`, `NewPostPage`, `PostsList`,
  `UsersListView`) out of the public `@ampless/admin/components` barrel
  and into private `tsup.config.ts` entries.

  Why: the previous barrel exports served a dual purpose — opt-in escape
  hatch + tsup chunk splitting. The escape-hatch reason was wrong for
  admin-only opinionated page bodies: nobody outside the admin pages
  factories has a legitimate reason to embed `LoginPage` or `MediaPage`
  on their own. The chunk-splitting reason is fully satisfied by private
  entries (same pattern `src/lib/theme-actions.ts` uses), so the public
  surface can shrink without re-introducing the inlining problem that
  caused `'use client'` to bleed onto `dist/pages/index.js` and break the
  server-side page factories.

  Behavior:
  - `dist/pages/index.js` stays server-safe (no `'use client'` directive,
    no client-component inputs).
  - View components emit as `dist/components/{admin-dashboard,login-view,
media-view,edit-post-view,new-post-view,posts-list-view,
users-list-view}.js`, each marked `"use client";`.
  - `dist/components/index.js` (the public barrel) no longer exports view
    components — only providers, forms, and utilities remain.

  No external consumer in this monorepo's templates imports any of the
  removed view exports, so this is a non-breaking change for first-party
  users. External consumers (if any) that imported these from
  `@ampless/admin/components` should switch to using the page factories
  (`@ampless/admin/pages`) which is the supported integration point.

## 0.2.0-alpha.10

### Patch Changes

- 09a34c3: Fix `next build` "Server Components cannot use Client function" error on
  the `/login` route (and any route reachable from `@ampless/admin/pages`).

  `UsersListView` is imported only by `src/pages/users-list.tsx`, so tsup
  had no incentive to put it in a shared chunk and inlined it directly into
  `dist/pages/index.js`. The `preserveDirectives` plugin then saw a
  `'use client'` input among the entry's inputs and applied `'use client'`
  to the whole entry — making every page factory (`createLoginPage`,
  `createDashboardPage`, etc.) a Client function and breaking app router
  pages that `import { createLoginPage } from '@ampless/admin/pages'`.

  Fixed by adding `src/components/users-list-view.tsx` as a private tsup
  entry (mirroring how `src/lib/theme-actions.ts` is split so its
  `'use server'` directive survives bundling). This keeps the admin-only
  users view out of the public `@ampless/admin/components` barrel while
  giving esbuild a reason to emit it as a separate chunk that
  `dist/pages/index.js` imports across the server/client boundary cleanly.

  Supersedes the earlier alpha that exported `UsersListView` from the
  public barrel — that approach worked but widened the public surface
  with an admin-only component.

## 0.2.0-alpha.9

### Patch Changes

- 88cd069: Fix `next build` "Server Components cannot use Client function" error on
  the `/login` route (and any other route that imports `createUsersListPage`
  indirectly via `@ampless/admin/pages`).

  `UsersListView` was missing from `src/components/index.ts`'s barrel. As a
  result tsup had no reason to put it in a shared chunk and inlined it
  straight into `dist/pages/index.js`. The `preserveDirectives` plugin then
  saw a `'use client'` input among the entry's inputs and (correctly)
  applied `'use client'` to the whole entry — making every page factory
  (`createLoginPage`, `createDashboardPage`, etc.) a Client function. App
  Router `app/login/page.tsx` imports `createLoginPage` from a Server
  Component context, which Next.js 16 then rejects with:

  ```
  × You're importing a component that imports createLoginPage. It's
    in a client boundary, but no other client component imports it.
  ```

  The other `*-view.tsx` Client components were already in the barrel for
  exactly this reason (see the comment in `src/components/index.ts`).
  `UsersListView` was added later and slipped through.

## 0.2.0-alpha.8

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
  - @ampless/runtime@0.2.0-alpha.5

## 0.2.0-alpha.7

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

- c5febac: Responsive admin layout: the sidebar collapses into a slide-in drawer below `md` (768px) with a sticky top bar and hamburger toggle, and turns back into a persistent 240px rail on tablets/desktops. The drawer auto-closes on route change and locks page scroll while open.

  Page bodies now use `mx-auto max-w-7xl p-4 md:p-8` so admin content centers on wide screens (previously page bodies stretched edge-to-edge with a fixed `p-8` and no max-width, which left forms anchored to the left of huge empty space and crushed under the sidebar on mobile). Page titles shrink to `text-2xl` below `md` to leave room for the action button next to them, and table containers gain `overflow-x-auto` so the posts / sites tables don't push out the viewport on narrow screens.

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2
  - @ampless/runtime@0.2.0-alpha.4

## 0.2.0-alpha.6

### Patch Changes

- Updated dependencies [55734e5]
  - @ampless/runtime@0.2.0-alpha.3

## 0.2.0-alpha.5

### Patch Changes

- 1e3fc43: Fix admin posts list / edit pages showing ampless's dummy `Hello, ampless` / `About ampless` / `Getting started` placeholders instead of the real data.

  `<AdminProviders>` ran `installAdminPostsProvider()` / `installAdminKvProvider()` from inside `useEffect`. React runs **child** useEffects before **parent** useEffects, so when a posts list page mounted, its own `useEffect → listPosts()` fired first — at that point ampless's global provider registry was still empty, so `listPosts` returned its built-in dummy posts. Same for `getPostById` on the edit page (returned `null` → 404).

  Move the registration calls out of `useEffect` and into the render body. They're idempotent (each install guards with an `installed` flag), so the synchronous call is safe during render, HMR remounts, etc. Now the provider is registered before any child component's effects run.

  Discovered via end-to-end Playwright session on the dogfood site: created a real post, saw it on the public home, then navigated to `/admin/posts` and got the dummy list back.

## 0.2.0-alpha.4

### Patch Changes

- e16a237: Fix `Variable 'body' has an invalid value` AppSync error when saving a markdown / HTML post.

  `encodeBody` short-circuited for string inputs and returned them as-is — but AppSync's AWSJSON scalar requires a JSON-encoded string on the wire. A raw markdown body like `# Hello` is not valid JSON; AppSync's validator rejects it.

  Always `JSON.stringify` on encode (including for strings, which become JSON string literals like `"# Hello"`). The decode side already handled both encoded and legacy bare strings via try/catch.

- d1a6045: Fix "The conditional request failed" DynamoDB error when saving a post that was published before the `PostTag` denormalized index existed.

  Symptom (from the dogfood site, ishinao.net): post-003 was status='published' since before the PostTag index was introduced, so no PostTag rows were ever written. Editing the post (e.g. changing `format` from markdown to tiptap) made `syncPostTags` compute the "update existing" branch from `oldPost.tags`, but AppSync's `update` mutation requires `attribute_exists(<PK>)` — and those rows weren't in DDB. Save failed with:

  ```
  The conditional request failed (Service: DynamoDb, Status Code: 400, ...)
  ```

  Make `syncPostTags` idempotent by switching both branches to upsert:
  - **New entries** (key only in newKeys): try `create` first; on conditional failure (orphan row left over from previous unclean delete) fall back to `update`.
  - **Existing entries** (key in both): try `update` first; on conditional failure (legacy post, row never created) fall back to `create`.

  Existing entries that no longer apply (delete branch) stay unchanged — `delete` is naturally idempotent.

  After this fix, legacy posts that were published before PostTag existed get their PostTag rows created automatically on first save.

- c3d73aa: Fix React Server Components serialization error when `cmsConfig.plugins` contained plugin instances (with non-serializable `hooks` functions).

  Symptom from the dogfood site:

  ```
  Runtime Error - Server

  Functions cannot be passed directly to Client Components unless you
  explicitly expose it by marking it with "use server". Or maybe you
  meant to call this function rather than return it.

    {content.published: function rebuild, content.unpublished: ..., ...}
  ```

  `createAdminLayout(admin)` passed `admin.cmsConfig` straight into the `<AdminProviders>` client component. Plugin instances in `cmsConfig.plugins` carry Lambda-side `hooks` (and `metadata`) functions that RSC's serializer cannot send across the server→client boundary.

  Strip plugin instances down to `{ name, apiVersion, trust_level }` before passing — admin's client-side state modules only read `cmsConfig.site` / `cmsConfig.sites` / `cmsConfig.media`, never plugin hooks, so the reduction is safe.

## 0.2.0-alpha.3

### Patch Changes

- bb66ea4: Move `AdminProviders` to `components/` so `dist/pages` stays server-side.

  `c8232a5` (preserve `'use client'` / `'use server'` directives) correctly tagged each output based on its inlined inputs, but `src/pages/` mixed server-side factories (`createAdminLayout`, `createSiteEditPage`, ...) with `'use client'` view modules (`dashboard.tsx`, `posts-list.tsx`, `admin-providers.tsx`, ...). That left `dist/pages/index.js` marked `'use client'`, and Next.js rejected `createAdminLayout(admin)` calls from Server Component shells with:

  > Attempted to call createAdminLayout() from the server but createAdminLayout is on the client.

  Fix:
  1. Move all `'use client'` view components out of `src/pages/` into `src/components/` (`admin-providers.tsx`, `admin-dashboard.tsx`, `posts-list-view.tsx`, `new-post-view.tsx`, `edit-post-view.tsx`, `media-view.tsx`, `login-view.tsx`). The files in `src/pages/` now hold only the server-side factory wrappers (`createAdminDashboardPage`, ...) that import the view across the boundary.
  2. Re-export the view components from `@ampless/admin/components` — both as an opt-in escape hatch and to keep tsup from inlining them back into `dist/pages/index.js`.
  3. Extract `ADMIN_SITE_COOKIE` into a directive-less `lib/admin-site-cookie.ts` so it can be shared between server-side `lib/admin-site.ts` and client-side `lib/admin-site-client.ts` without pulling the `'use client'` boundary into the locale/i18n chunk that `dist/index.js` consumes.
  4. Split `lib/theme-actions.ts` (`'use server'`) into its own tsup entry so it ends up in a dedicated `'use server'`-tagged file instead of getting mixed into the shared client-components chunk.
  5. Extend the `preserveDirectives` plugin in `tsup.config.ts` to also tag internal chunks whose inputs are purely `'use client'` (or purely `'use server'`). This is what lets `chunk-*-clients.js` ship a real boundary marker that Next.js can detect when a server-side `pages/index.js` imports a view component from it. Chunks that mix both directives are still left un-tagged with a warning.

  The public API of `@ampless/admin/pages` and `@ampless/admin/components` is unchanged — same factory names, same call shape.

## 0.2.0-alpha.2

### Patch Changes

- c8232a5: Preserve `'use client'` / `'use server'` directives in the tsup build.

  tsup (via esbuild) strips per-file directives when it concatenates source modules into a single output. That had been causing `TypeError: Class extends value undefined is not a constructor or null` whenever a Next.js server component imported from `@ampless/admin/pages` — the bundle was evaluated server-side and `react-image-crop`'s `ReactCrop` class blew up.

  A custom inline esbuild plugin in `packages/admin/tsup.config.ts` now:
  1. Taps `onLoad` to record which source files start with `'use client'` / `'use server'`.
  2. On build end, uses `metafile` to map each emitted output back to the source files inlined into it.
  3. Prepends the directive to entry outputs (`dist/pages/index.js`, `dist/components/index.js`) whose own direct inputs or — for pure re-export shim entries — whose imported chunks carry the directive.
  4. Leaves substantive server entries (`dist/index.js`, `dist/api/index.js`) and internal shared chunks untagged, so the server-side `createAdmin` factory can still consume constants from chunks shared with client code.

  Earlier off-the-shelf attempts (`rollup-plugin-preserve-directives`, `esbuild-plugin-preserve-directives`) didn't work with the current tsup / esbuild versions.

  The `'use client'` workaround in the templates' `components/i18n-provider.tsx` shim is now defensive — `dist/components/index.js` carries the directive itself — but harmless to keep.

- Updated dependencies [da08397]
  - @ampless/runtime@0.2.0-alpha.2

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
  - @ampless/runtime@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0
  - @ampless/runtime@0.2.0-alpha.0
