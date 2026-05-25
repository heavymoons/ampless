# @ampless/backend

## 1.0.0-alpha.23

### Patch Changes

- 6b46669: Bump direct dependencies to their latest semver-minor / patch versions.
  No source changes — `pnpm install` + `pnpm-lock.yaml` regeneration only,
  verified clean on `pnpm lint` / `pnpm test` / `pnpm build`.

  Notable bumps (all backward-compatible):
  - AWS SDK v3 clients: `^3.717.0` → `^3.1053.0` across backend / mcp-server.
  - `@aws-amplify/backend`: `^1.13.0` → `^1.22.0`; `aws-cdk-lib`: `^2.174.0` → `^2.257.0`.
  - `@modelcontextprotocol/sdk`: `^1.0.0` → `^1.29.0`.
  - Tailwind CSS: `^4.0.0` → `^4.3.0` (templates).
  - Radix UI primitives, React 19.x, `@aws-amplify/adapter-nextjs`, tiptap 3.23.x — all minor / patch.

  Also touches the `templates/_shared` README + AGENTS, replacing the
  stale "Next.js 15" claim with "Next.js 16" so the user-facing docs
  match the actual pinned version (`next@^16.2.6`).

  Out of scope for this update (deferred to follow-ups): `pnpm` 9 → 11
  (packageManager), `marked` 14 → 18 (runtime markdown rendering),
  `@types/node` 22 → 25 (intentionally pinned at 22 — project requires
  Node 20+ at runtime).

  Known leftover advisories (`pnpm audit`): 23 vulnerabilities surface
  in transitive deps pulled by upstream packages (handlebars / lodash /
  hono / fast-uri / etc. via Amplify backend, AWS SDK, MCP SDK). None
  are reachable through ampless's own surface; resolution is upstream.

- Updated dependencies [6b46669]
  - ampless@1.0.0-alpha.12
  - @ampless/mcp-server@1.0.0-alpha.13

## 1.0.0-alpha.22

### Minor Changes

- 6c0fc12: Move MCP HTTP token storage from the shared `KvStore` model to a new
  admin-only `McpToken` AppSync model. Editors can no longer mint MCP
  tokens by writing crafted rows to `KvStore` — token CRUD now flows
  through a model whose `allow.groups(['ampless-admin'])` rule is
  enforced at the AppSync layer, and the validating Lambda reads the
  new DynamoDB table directly with a `dynamodb:GetItem` IAM grant
  scoped to that table only.

  **Breaking change for alpha deployments**: any MCP tokens already
  issued live under the old `pk='mcp-tokens'` KvStore rows, which the
  new validator never consults. Re-issue tokens through the admin UI
  after deploying this version. The `AMPLESS_KV_TABLE` env var the
  mcp-handler Lambda used is replaced by `AMPLESS_MCP_TOKEN_TABLE`;
  the backend wiring sets this automatically, but custom deployments
  that pinned the old variable must update.

  The new model uses `issuedAt` (renamed from the previous `createdAt`
  field on the in-storage shape) so it doesn't collide with Amplify's
  auto-managed `createdAt` column.

## 1.0.0-alpha.21

### Patch Changes

- Updated dependencies [dbc7e43]
  - ampless@1.0.0-alpha.11
  - @ampless/mcp-server@1.0.0-alpha.12

## 1.0.0-alpha.20

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
  - @ampless/mcp-server@1.0.0-alpha.11

## 1.0.0-alpha.19

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

### Patch Changes

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

- Updated dependencies [af1f9b0]
- Updated dependencies [af1f9b0]
- Updated dependencies [16b8f09]
  - ampless@1.0.0-alpha.9
  - @ampless/mcp-server@1.0.0-alpha.10

## 0.2.0-alpha.18

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
  - @ampless/mcp-server@0.2.0-alpha.9

## 0.2.0-alpha.17

### Patch Changes

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

- Updated dependencies [76abf3d]
  - @ampless/mcp-server@0.2.0-alpha.8

## 0.2.0-alpha.16

### Minor Changes

- 64fd93b: v0.2 MCP HTTP transport — Phase 5 (media upload).

  `upload_media` is now reachable over HTTP. The Lambda decodes the
  base64 body from the tool call params, uploads bytes to S3 under
  `public/media/{YYYY}/{MM}/{epochMs}-{filename}`, and creates the
  Media row through the same AppSync IAM auth path that the post CRUD
  tools use.

  Implementation choice: inline base64, matching the stdio CLI. Keeps
  the tool surface uniform (LLM clients call `upload_media` with the
  same args regardless of transport) and stays within the MCP protocol
  without a side-channel HTTP PUT step. Trade-off: limited by the
  Lambda synchronous payload cap (~6 MB after JSON envelope = ~4 MB of
  binary). Typical CMS image uploads fit; video or large files should
  use the stdio CLI until v0.3 introduces a presigned-PUT flow.

  Backend wiring:
  - mcp-handler Lambda gains `s3:PutObject` on the storage bucket's
    `public/media/*` prefix (matches what `buildMediaKey` produces).
  - New `AMPLESS_BUCKET_NAME` env var (read at handler cold start).
  - The `tools/list` registry no longer filters out `upload_media`;
    the handler's storage thunk returns a real `S3Client`-backed
    putObject instead of the Phase 4 "not implemented" stub.

## 0.2.0-alpha.15

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
- Updated dependencies [c87773b]
  - ampless@0.2.0-alpha.7
  - @ampless/mcp-server@0.2.0-alpha.7

## 0.2.0-alpha.14

### Patch Changes

- d5d360b: Fix `tsc --noEmit` failure on the template `amplify/data/resource.ts`
  when downstream projects build with strict TypeScript settings (e.g.
  Amplify Hosting's Next.js build worker).

  `amplessSchemaAuthorization`'s return type was `unknown[]`, which
  `.authorization((allow) => ...)` rejects: the schema builder wants
  `SchemaAuthorization<any, any, any> | SchemaAuthorization<any, any, any>[]`,
  and `unknown` doesn't narrow into that. The error surfaced as:

  ```
  ./amplify/data/resource.ts:47:29
  Type error: Type 'unknown[]' is not assignable to type
  'SchemaAuthorization<any, any, any> | SchemaAuthorization<any, any, any>[]'.
  ```

  Widen the return type to `any[]`, matching the rest of this module's
  intentional looseness around `@aws-amplify/data-schema`'s heavily
  generic builder types. The schema itself still resolves through
  `ClientSchema<typeof schema>` correctly downstream.

## 0.2.0-alpha.13

### Patch Changes

- 12628a5: Fix MCP HTTP endpoint always returning `invalid_token` for tokens
  issued through the admin UI.

  `mcp-handler.ts` read DynamoDB rows where `value` is an `a.json()`
  field and assumed the attribute was always a JSON-encoded string. In
  practice the admin UI's `installAdminKvProvider` calls AppSync's
  auto-generated `CreateKvStore` mutation, which parses the incoming
  AWSJSON input and stores `value` as a **native DynamoDB Map**. When
  `DynamoDBDocumentClient` unmarshals it on read, it comes back as a
  plain JS object — `JSON.parse(row.value)` then sees `[object Object]`,
  throws, and the validator returns `null` → every Bearer turns into
  401 `invalid_token`.

  The existing trusted-processor's site-settings cache already dodges
  this with `typeof raw === 'string' ? safeParse(raw) : raw`. Apply the
  same dual-shape handling to the token validator: pass-through when
  the value is already an object, JSON.parse when it's a string,
  diagnostic-log + reject only when the shape is neither.

  Regression test added: a row with `value` shaped as a native object
  (matching what production DDB actually contains) now validates the
  same as a row with `value` shaped as a JSON string.

## 0.2.0-alpha.12

### Minor Changes

- 3e534c4: Fix `[TypeError] allow.resource is not a function` during CDK deploy of
  the v0.2 Phase 4 MCP HTTP transport.

  Root cause: model-level `.authorization((allow) => [...])` callbacks in
  `@aws-amplify/data-schema` destructure `resource` out of their `allow`
  parameter before invoking the callback (`ModelType.js`: `const { resource: _, ...rest } = Authorization_1.allow`).
  The `.d.ts` files still surface `.resource` on the model-level `allow`
  type, which misled Phase 4 into believing it could grant the MCP Lambda
  access per-model. At runtime the property is missing and CDK Assembly
  fails. The TODO comment in `Authorization.js` confirms it:
  "delete when we make resource auth available at each level in the schema
  (model, field)" — currently it's schema-scope only.

  Fix: move the resource grant from each model's authorization clause to
  schema scope. `amplessSchemaModels` no longer accepts
  `mcpHandlerFunction`; a new exported helper does:

  ```typescript
  import { amplessSchemaModels, amplessSchemaAuthorization } from '@ampless/backend'

  const schema = a
    .schema({
      ...amplessSchemaModels(a, { resolverPaths, userAdminFunction: userAdmin }),
      ...customSchemaModels(a),
    })
    .authorization((allow) =>
      amplessSchemaAuthorization(allow, {
        mcpHandlerFunction: mcpHandler,
      })
    )
  ```

  The template `amplify/data/resource.ts` is updated accordingly so
  `update-ampless` carries the fix to existing projects. Schema-scope
  resource auth is wider than model-scope would have been (the grant
  applies to every model in the schema instead of only Post / PostTag /
  Media), but it's the only level the upstream library honours; the MCP
  tools' GraphQL operations narrow the effective surface anyway.

## 0.2.0-alpha.11

### Minor Changes

- e3141ff: v0.2 MCP HTTP transport — Phase 4 (tool dispatch via AppSync IAM auth).

  The mcp-handler Lambda now parses incoming JSON-RPC 2.0 envelopes
  and dispatches `tools/call` through `@ampless/mcp-server/tools`'
  shared registry. AppSync IAM auth lets the Lambda read and write
  Post / PostTag tables under its own scoped role — no Cognito
  identity, no shared API key.

  What works now over HTTP:
  - list_posts / get_post / get_schema (reads)
  - create_post / update_post / delete_post (writes)
  - Standard JSON-RPC verbs: initialize, tools/list, tools/call

  What's still pending:
  - upload_media — needs presigned S3 PUT URL flow, lands in Phase 5

  Template `amplify/data/resource.ts` now threads the mcp-handler
  function ref into `amplessSchemaModels(a, { mcpHandlerFunction })`,
  which gates the `allow.resource(...).to(['query', 'mutate'])` clause
  on Post + PostTag. Existing projects pick it up via
  `npm run update-ampless` followed by a redeploy.

## 0.2.0-alpha.10

### Patch Changes

- c9c3f7d: Fix CloudFormation deployment failure for the `mcp-handler` Function
  URL added in the Phase 3 of the v0.2 MCP HTTP transport rebuild.

  The CFN error:

  > Properties validation failed for resource
  > `mcphandlerlambdaFunctionUrl1CB2E3DA` with message: ...
  > The stack named ... failed to deploy: UPDATE_ROLLBACK_COMPLETE

  Root cause: the CORS `allowedMethods` list included
  `HttpMethod.OPTIONS`. The CDK `HttpMethod` enum exposes `OPTIONS`, so
  TypeScript was happy, but the Lambda Function URL's CFN resource only
  accepts `* | GET | PUT | HEAD | POST | PATCH | DELETE` and rejects
  `OPTIONS` at deploy time. Preflight is handled automatically by the
  Function URL CORS layer — `allowedMethods` should only list the
  "real" HTTP methods the endpoint serves.

  Fix: drop `HttpMethod.OPTIONS` from the list, leaving `[POST]`. The
  handler's defensive 204-on-OPTIONS branch stays (it's harmless and
  covers any non-CORS client that sends OPTIONS manually).

## 0.2.0-alpha.9

### Minor Changes

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

## 0.2.0-alpha.8

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

## 0.2.0-alpha.7

### Patch Changes

- Updated dependencies [ddbffbf]
  - ampless@0.2.0-alpha.5

## 0.2.0-alpha.6

### Patch Changes

- Updated dependencies [bb6c2ae]
  - ampless@0.2.0-alpha.4

## 0.2.0-alpha.5

### Patch Changes

- 461dba0: Fix `Cannot read properties of undefined (reading 'fieldName')`
  TypeError thrown by the user-admin Lambda when the admin UI calls
  `listAdminUsers` / `setAdminUserRole`.

  Amplify Gen 2's `a.handler.function()` does NOT register the Lambda as
  a canonical direct AppSync resolver — it generates a PIPELINE resolver
  whose Lambda-invocation function emits a flat VTL payload:

      {
        "operation": "Invoke",
        "payload": {
          "typeName": "Query",
          "fieldName": "listAdminUsers",
          "arguments": { ... },
          "identity": ...,
          ...
        }
      }

  The Lambda receives `event.fieldName` at the top level, NOT
  `event.info.fieldName`. Typing the handler as `AppSyncResolverHandler`
  was misleading and made `event.info` resolve to `undefined` at runtime.

  Switch to a `Handler<UserAdminEvent>` typed against the actual flat
  payload shape.

## 0.2.0-alpha.4

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

## 0.2.0-alpha.3

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

## 0.2.0-alpha.2

### Patch Changes

- a81f7e4: Fix `next build` type error on scaffolded `amplify/events/processor-{trusted,untrusted}/handler.ts`:

  ```
  Type '(string | AmplessPlugin)[] | undefined' is not assignable to type 'AmplessPlugin[] | undefined'.
  ```

  `Config['plugins']` (the type of `cms.config.plugins`) is `Array<AmplessPlugin | string>` to leave room for string-name entries used by future dynamic loading. The processor factories' `opts.plugins` was typed `AmplessPlugin[]`, so the thin-shell `plugins: config.plugins` pass-through failed Next.js 16's stricter type check at production build.

  Both processor factories already filter out non-object entries at runtime; widen the `opts.plugins` type to `Config['plugins']` so the scaffolded shell type-checks cleanly without a cast.

  Surfaced via Amplify Hosting build for the dogfood site `ampless.heavymoons.net`.

## 0.2.0-alpha.1

### Minor Changes

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
