# @ampless/mcp-server

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
