# create-ampless

## 0.2.0-alpha.22

### Minor Changes

- 6743856: `update-ampless` now deletes files from ampless-managed `app/`
  subdirectories that no longer exist in the current template. This
  fixes the long-standing issue where route shells scaffolded by older
  alpha versions linger after the template removes them — most
  recently the `/api/mcp` and `/api/admin/mcp-tokens` routes that PR #57
  dropped along with the Cognito-service-user HTTP MCP, leaving
  projects on alpha.18+ with broken imports against the newer
  `@ampless/admin` exports.

  Managed paths (where deletion applies):
  - `app/(admin)/admin`
  - `app/api/admin`
  - `app/api/media`
  - `app/api/mcp`
  - `app/login`
  - `app/site`

  Anything outside these paths is untouched — user-owned top-level
  routes (`app/page.tsx`, custom `app/blog/`, etc.) are safe. Within
  managed paths, ampless owns the directory wholesale; user
  customisations belong elsewhere.

  Empty subdirectories left behind by the deletion are pruned
  automatically (bottom-up).

## 0.2.0-alpha.21

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

## 0.2.0-alpha.20

### Minor Changes

- be19cc2: Ship `AGENTS.md` (+ Japanese translation) in the shared project template. AI coding agents read this file at the project root to learn which paths they can edit, how to copy and customise a theme, how to register the ampless MCP server, and which constraints (ephemeral sandbox data, multi-site cache disablement, etc.) to be aware of. Existing `README.md` gets a one-line pointer to it.

### Patch Changes

- 3c1de9c: Republish `create-ampless` so the npm tarball picks up the Next.js 16 README bump from #53 (the PR merged without a changeset, so the doc fix never reached npm).

## 0.2.0-alpha.19

### Patch Changes

- 3a64448: Ship a comprehensive user-level `README.md` (English + Japanese) in scaffolded projects.

  `templates/_shared/README.md` is now a full orientation guide for site owners: requirements, every `npm` script, first-run flow, admin UI map, authoring formats, theme switching / customization, plugin enable / install pattern, GitHub-to-Amplify-Hosting deploy flow with `amplify.yml`, environment variable conventions, custom-domain wiring, multi-site, MCP integration, and the `update-ampless` upgrade flow.

  `RUNBOOK.md` is reframed as a recipe book for occasional operations, with a table of contents and a top-line pointer back to `README.md` for everyday usage. Existing recipes (API key rotation, user promotion, password reset, backup restore, failed plugin events, custom domain setup, multi-site caveats) are unchanged.

  Both files ship in English (`README.md` / `RUNBOOK.md`) and Japanese (`README.ja.md` / `RUNBOOK.ja.md`) with language-toggle headers.

## 0.2.0-alpha.18

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

## 0.2.0-alpha.17

### Patch Changes

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

## 0.2.0-alpha.16

### Patch Changes

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

## 0.2.0-alpha.15

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

## 0.2.0-alpha.14

### Patch Changes

- 0fd9751: Consolidate the two sandbox-related `package.json` scripts into one.

  Before:
  - `sandbox` = `ampx sandbox` (continuous watch — rarely used in practice)
  - `sandbox:dev` = `ampx sandbox --once && next dev` (the actually-useful one)

  After:
  - `sandbox` = `ampx sandbox --once && next dev`

  The continuous-watch flow stays available as `npx ampx sandbox` for the
  edge cases that need it, but the rarely-used npm script is gone and the
  `:dev` suffix no longer dangles meaninglessly.

  `create-ampless upgrade` will remove the now-orphaned `sandbox:dev`
  key from existing projects' `package.json` on the next run — the
  managed-scripts sync now iterates the allowlist (rather than the
  template) so keys ampless used to own but has since dropped get
  cleaned up automatically.

  Theme READMEs, the `create-ampless` post-scaffold "next steps" outro,
  and related docs are updated to recommend `npm run sandbox`.

## 0.2.0-alpha.13

### Patch Changes

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

## 0.2.0-alpha.12

### Patch Changes

- 818ed1c: Add explicit Tailwind v4 `@source` directives to `app/globals.css` so
  classes used inside the `@ampless/admin` and `@ampless/runtime` dist
  files actually make it into the generated CSS.

  Tailwind v4 skips `node_modules/` during its automatic content
  detection. Every utility used only inside the admin UI (e.g. the
  sidebar's `flex`, `fixed`, `md:sticky`, ...) was tree-shaken out, and
  the admin layout fell back to browser defaults — sidebar overlapped
  main content on `/admin`.

  Surfaced via the `ishinao.net` dogfood site.

## 0.2.0-alpha.11

### Patch Changes

- 8d95e77: Fix `CloudformationStackCircularDependencyError` during `ampx
pipeline-deploy` on the scaffolded template by assigning every Lambda
  to its proper nested stack:
  - `amplify/auth/post-confirmation/resource.ts` — was in the default
    `function` stack, making auth ↔ function a cycle (auth references
    the trigger arn; the Lambda references the user pool). Pin to
    `resourceGroupName: 'auth'`.
  - `amplify/events/processor-untrusted/resource.ts` — was in the
    default `function` stack, making function ↔ data a cycle (function
    references the SQS queue and DDB table in data; data already
    references `processor-trusted` in the data stack). Pin to
    `resourceGroupName: 'data'` to match the dispatcher /
    processor-trusted siblings.
  - `amplify/functions/user-admin/resource.ts` — comment updated to
    match the wording style already used in upgraded ampless
    installs (no behavior change; `resourceGroupName: 'data'` was
    already set).

  After this patch the `function` nested stack is empty (every Lambda is
  assigned to `auth` or `data`), and CloudFormation no longer cycles
  between the four nested stacks.

## 0.2.0-alpha.10

### Patch Changes

- 88cd069: `update-ampless` / `copy-theme` template scripts (and help / log text) now use `npx create-ampless@latest …` instead of `@alpha`. The published `alpha` dist tag had been stuck on `0.2.0-alpha.0` (changesets/action only updates `latest` on publish), so `npx create-ampless@alpha upgrade` was silently resolving to the pre-`upgrade` version of the CLI and falling through to the scaffolding prompts. `latest` is what changesets actually publishes to, so pointing at it works for both pre-release and stable lines.

  A new `scripts/sync-alpha-dist-tag.mjs` runs after `changeset publish` in the release script. When in pre-release mode it re-tags every just-published workspace package as `alpha = <current version>`, so `npx <pkg>@alpha` keeps resolving to the same thing as `@latest`. The script no-ops out of pre mode so the alpha tag deliberately freezes when the project exits to stable.

## 0.2.0-alpha.9

### Minor Changes

- 0b90ca8: Three changes to the scaffolding / upgrade story:

  **1. Default themes = all six.** Both the interactive scaffold (`initialValues`) and the non-interactive `--skip-confirm` path now install `blog`, `minimal`, `landing`, `corporate`, `docs`, and `dads` by default. The shared `themes-registry.ts` placeholder already references every shipped theme, so this matches what the runtime expects out of the box and lets users prototype theme switching without re-scaffolding.

  **2. `copy-theme` subcommand for project-owned themes.** `npx create-ampless@alpha copy-theme <source> <target>` (or `npm run copy-theme -- <source> <target>`) clones an installed theme into a new directory under `themes/`, rewriting the internal `name` references in `index.ts` / `manifest.ts` plus the `[data-theme='…']` scope in `tokens.css`. The target name must use the `my-` prefix — this is the convention that flags a theme as user-owned. Ampless-managed default themes (`blog`, `minimal`, …) are now resynced from the latest template on every `upgrade`; `my-*` themes are never touched.

  **3. `themes-registry.ts` is now auto-managed.** Both `scaffold` and `upgrade` regenerate it from the directories actually present under `themes/`. Custom themes get registered automatically (no more "I added a directory but the build doesn't see it"); removed themes vanish. Hyphenated names like `my-blog` import under a camelCase alias (`myBlog`) and index the exported map with the kebab-case string literal, so `theme.active = 'my-blog'` resolves to the right module at runtime.

  **Upgrade additions:**
  - Theme sync replaces every shipped theme dir (preserving `README.md` and `.gitignore` so user docs / vcs hints survive) and preserves `my-*` themes intact.
  - `package.json` script merging is generalised: ampless owns an allowlist (`sandbox`, `sandbox:dev`, `update-ampless`, `copy-theme`) and the user's other scripts (`dev`, `build`, …) survive every upgrade.

  **Template package.json additions:**
  - `sandbox:dev`: `ampx sandbox --once && next dev` — one-shot sandbox deploy followed by the dev server. Convenient for local verification when you don't need the watch-mode sandbox.
  - `copy-theme`: ergonomic alias for `npx create-ampless@alpha copy-theme`.

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

- 0b90ca8: Add `upgrade` subcommand for syncing ampless template files and dependencies in existing projects.
- 31925fd: Add `.custom.ts` extension points (`amplify/backend.custom.ts`,
  `amplify/data/resource.custom.ts`) for user customizations. These
  files are never overwritten by `create-ampless upgrade`, so ampless
  can safely refresh `backend.ts` / `data/resource.ts` while preserving
  project-specific extensions.

## 0.2.0-alpha.8

### Patch Changes

- 688173d: Two `--mount` / `--deploy` polish fixes surfaced while mounting an existing
  project onto a renamed GitHub slug:
  1. `--skip-confirm` now correctly suppresses the "Repository visibility"
     `select` prompt in `gatherDeployOptions`. Previously the prompt fired
     even with `--skip-confirm` because the guard only short-circuited when
     `--github-private` was explicitly passed.
  2. `ghRepoExists` now uses `gh repo view --json nameWithOwner` and
     compares the resolved name to the requested slug. GitHub keeps a
     redirect from old → new repo names after a rename, so `gh repo view
<old-name>` would succeed (false positive) and `--mount` would try to
     `git push` to the renamed repo instead of creating a fresh one at the
     originally-typed slug.

## 0.2.0-alpha.7

### Minor Changes

- a640271: Add `--mount` mode: publish an existing ampless project (in the current
  directory) onto a new GitHub repo + Amplify Hosting app + custom domain,
  without re-running scaffold.

  Usage (after scaffolding and testing locally with `npx ampx sandbox`):

  ```sh
  cd my-existing-ampless-project
  npx create-ampless@alpha --mount \
    --github-owner <login> \
    --aws-profile <profile> \
    --aws-region <region> \
    --domain example.com \
    --create-iam-role \
    --skip-confirm
  ```

  Behavior:
  - Validates that the cwd looks like an ampless project (`package.json`,
    `cms.config.ts`, and an `amplify/` directory) before any side effects.
  - Skips scaffolding entirely. `--site-name`, `--themes`, `--plugins`, and
    the positional `<project-name>` are ignored (with a warning).
  - `git init`/commit step is idempotent: re-uses an existing git repo,
    commits any pending changes, and warns if the current branch isn't
    `main` (Amplify Hosting wires up `main`).
  - `gh repo create` step is idempotent: if the target
    `<owner>/<basename(cwd)>` repo already exists, sets up `origin` (if
    unset) and pushes the current commit to `main` instead of trying to
    re-create.
  - Drops a sensible default `.gitignore` if the project doesn't have one,
    so `amplify_outputs.json`, `node_modules`, and `.next` aren't
    accidentally committed.
  - Pre-flight's "GitHub repo must not exist" check is relaxed in mount
    mode.

  `--mount` implies `--deploy` — the rest of the deploy flow (Amplify
  Hosting app, main branch, first build, custom domain) is shared with the
  existing `--deploy` mode.

## 0.2.0-alpha.6

### Patch Changes

- 73b7462: Add --site-name, --themes, --plugins flags; skip all prompts when --skip-confirm is set

## 0.2.0-alpha.5

### Minor Changes

- efe05a7: Add `--deploy` flag for end-to-end GitHub + Amplify Hosting setup. After scaffolding, the CLI can now `git init`, create + push to a GitHub repo (`gh repo create`), provision an Amplify Hosting app, create a `main` branch, kick off the first deploy, and optionally attach a custom domain (auto-detecting Route 53 hosted zones when present, or surfacing CNAME records to add manually).

  Missing values are prompted interactively; fully-flagged invocations work for CI. New flags: `--deploy`, `--github-owner`, `--github-private`, `--github-token`, `--aws-profile`, `--aws-region`, `--domain`, `--subdomain`, `--skip-confirm`, plus `-h`/`--help`. A starter `amplify.yml` build spec also ships in the scaffolded project so non-`--deploy` users have a working starting point for later Amplify Hosting setup.

## 0.2.0-alpha.4

### Patch Changes

- 8695647: Fix `Auth UserPool not configured` error on `/login` and other top-level routes.

  `templates/_shared/lib/amplify.ts` was previously a no-op shim, with a comment saying `<AdminProviders>` (mounted by the admin layout factory) would call `Amplify.configure()` on first render. But `/login` is a top-level route at `app/login/page.tsx`, outside the `(admin)` route group, so it never mounts AdminProviders. Anyone trying to sign up or sign in hit:

  ```
  Auth UserPool not configured.
  ```

  Restore the actual `Amplify.configure(outputs, { ssr: true })` side effect to `lib/amplify.ts`. Now imported from `app/providers.tsx` so it runs at the root of every page (public, login, admin), idempotent with the configure that AdminProviders also performs.

  Existing scaffolds need to copy the updated `lib/amplify.ts` over.

## 0.2.0-alpha.3

### Patch Changes

- da08397: Inline the proxy matcher config in scaffolded `proxy.ts`. Next.js 16's Turbopack requires `export const config` in middleware/proxy files to be a statically analysable object literal — referencing an imported variable (like `defaultMatcherConfig` from `@ampless/runtime/middleware`) fails the build:

  ```
  Next.js can't recognize the exported `config` field in route.
  It needs to be a static object.
  ```

  Drop the re-export pattern and inline the matcher array in the scaffold. `defaultMatcherConfig` stays exported from `@ampless/runtime/middleware` as a documentation reference (with a JSDoc note explaining the Turbopack constraint), but isn't used by the scaffold anymore.

  Existing scaffolds need to edit their `proxy.ts` (or `middleware.ts`) to inline `config = { matcher: [...] }` directly.

## 0.2.0-alpha.2

### Patch Changes

- ce0abd0: Fix `TypeError: Class extends value undefined is not a constructor or null` from `components/i18n-provider.tsx` shim when imported from a server module.

  Root cause: tsup (via esbuild) strips per-file `'use client'` directives during the `@ampless/admin` build. When `app/layout.tsx` imports the shim from a server context, Next.js tries to evaluate the React-hook-using `I18nProvider` body in the RSC server runtime and crashes.

  Add `'use client'` to `templates/_shared/components/i18n-provider.tsx` so the shim itself is a client boundary; Next.js then bundles the re-exported admin components as client code and never tries to evaluate them server-side.

  Existing scaffolds need to copy this edit (add `'use client'` to their `components/i18n-provider.tsx`).

  Also tried installing `rollup-plugin-preserve-directives` and `esbuild-plugin-preserve-directives` in the admin build pipeline; neither is compatible with current tsup/esbuild versions. The shim-side fix is sufficient for now since all current consumers go through it.

- 1608b88: Fix second TDZ trap: `lib/admin.ts` was passing the `ampless` runtime instance to `createAdmin`, which read the binding eagerly at module init. Under the circular chain (`lib/ampless.ts` → themes-registry → theme pages → `lib/i18n.ts` → `lib/admin.ts`), `ampless` is still in its TDZ when admin.ts evaluates and crashes.

  Dropped the `ampless` parameter from the `createAdmin` call in `templates/_shared/lib/admin.ts`. `createAdmin` builds its own internal runtime instance when omitted (per L2's optional-param design), which is functionally equivalent for admin's needs — admin manages content and doesn't render themed pages, so it doesn't need theme resolution from the public-side ampless.

  Also defensively wrapped `templates/_shared/lib/i18n.ts`'s `export const t = admin.t` in an arrow function so future circular paths through i18n don't reintroduce a TDZ.

  Existing scaffolds need to copy these two edits over from the updated templates.

- 93ea408: Rename scaffolded `middleware.ts` → `proxy.ts` to match Next.js 16's renamed file convention, and update the exported binding from `middleware` to `proxy`. Next 16 emits a deprecation warning on `middleware.ts` and the rename silences it.

  The runtime helper `createAmplessMiddleware` keeps its name for API stability (the package-side name doesn't drive Next's file convention).

  Existing scaffolds need to rename their `middleware.ts` file to `proxy.ts` and rename the `middleware` export to `proxy`.

- ac7e642: Fix `Cannot access 'ampless' before initialization` ReferenceError that crashed scaffolded sites at request time.

  The back-compat shims in `templates/_shared/lib/{posts-public,site-settings,seo,storage,theme-active,theme-config,admin-site,auth-server}.ts` used `ampless.X.bind(ampless)` / `admin.X.bind(admin)` to re-export methods. That eagerly reads the `ampless` (or `admin`) binding at module evaluation, which loses against the circular import chain:

  ```
  lib/ampless.ts
    → ../themes-registry
      → ../themes/<name>/index.ts
        → ../themes/<name>/pages/home.tsx
          → @/lib/posts-public  (the shim)
            → @/lib/ampless     ← still in TDZ here
  ```

  Replaced every `.bind(X)` with an arrow function wrapper (`(...args) => X.method(...args)`) so the binding is read at call time instead. Existing scaffolds need to apply the same edit to their `lib/*.ts` files (or copy from the updated templates).

  Discovered when sandbox-deploying the first dogfood site against alpha.1.

## 0.2.0-alpha.1

### Patch Changes

- 6e25202: **Breaking:** Replace `defineAmplessAuth` / `defineAmplessStorage` with `amplessAuthConfig` / `amplessStorageConfig` config-builder helpers. The Amplify factory call (`defineAuth` / `defineStorage`) now happens in the user's `amplify/{auth,storage}/resource.ts` directly.

  Amplify Gen 2's import-path verifier inspects the stack trace of `defineAuth` / `defineData` / `defineStorage` and requires the call to originate from `amplify/{auth,data,storage}/resource.ts`. Wrapping those factories in this package made every `ampx sandbox` / deploy fail with `Amplify Auth must be defined in amplify/auth/resource.ts`. Returning a config object instead lets the user invoke the Amplify factory from the canonical location.

  Migration in `amplify/auth/resource.ts`:

  ```ts
  // before
  import { defineAmplessAuth } from '@ampless/backend'
  export const auth = defineAmplessAuth({ postConfirmation })

  // after
  import { defineAuth } from '@aws-amplify/backend'
  import { amplessAuthConfig } from '@ampless/backend'
  export const auth = defineAuth(amplessAuthConfig({ postConfirmation }))
  ```

  Same shape for `amplify/storage/resource.ts` (`defineStorage(amplessStorageConfig())`). The `templates/_shared/amplify/{auth,storage}/resource.ts` shells in `create-ampless` have been updated, so new scaffolds pick this up automatically.

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
