> 日本語版: [04-access-layer-mcp.ja.md](./04-access-layer-mcp.ja.md)
> 
## 4. Access Layer and MCP

### Design Philosophy

All persistent state lives in DynamoDB + S3 behind a single AppSync GraphQL endpoint. Every client (Admin UI, MCP HTTP handler, public read traffic) reaches that endpoint with a different auth mode — there is no separate CRUD service.

```
Admin UI  (Next.js)  → AppSync (Cognito User Pool, admin/editor groups) →┐
MCP Lambda (HTTP)    → AppSync (IAM / SigV4 via resource auth)           ├→ DynamoDB / S3
Public site / themes → AppSync (apiKey, custom resolvers strip drafts)   ─┘
```

The `ampless` package itself does not carry CRUD logic. It exports types, theme/plugin contracts, format helpers, and a small `PostsProvider` interface ([`packages/ampless/src/core.ts`](../../packages/ampless/src/core.ts)) so that admin and runtime callers can be wired against either the live Amplify Data client or test fixtures.

### Authentication

Standard Cognito **email + password** auth (SRP). Implemented via Amplify Auth ([`packages/backend/src/auth/index.ts`](../../packages/backend/src/auth/index.ts)) with no custom flow.

```typescript
// resolved by @ampless/backend → amplify/auth/resource.ts
defineAuth({
  loginWith: { email: true },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation: defineFunction({ /* promote first user to admin */ }),
  },
})
```

The login UI ([`packages/admin/src/components/login-view.tsx`](../../packages/admin/src/components/login-view.tsx)) covers the standard Cognito modes:

| Mode | Purpose |
|---|---|
| `signIn` | Email + password login (existing user) |
| `signUp` | New account (admin-invited or self-signup) → confirmation code emailed |
| `confirm` | Enter the emailed code to verify the address |
| `forgot` | Trigger a password-reset email |
| `reset` | Set a new password using the emailed code |

Passwordless flows (magic link / WebAuthn) are not used. Adopting them later would be a config swap on `defineAuth`, not a redesign.

#### Cognito User Groups

Three groups are declared. The admin app surfaces only the first two as assignable roles — `ampless-reader` is the implicit landing state for any account not promoted to admin/editor.

| Group | Description |
|---|---|
| `ampless-admin` | Full permissions: user management, site settings, plugin management, MCP token issuance |
| `ampless-editor` | Create / edit / delete content. Treated as a trusted principal (see below) |
| `ampless-reader` | Default for un-promoted accounts. No admin UI access; the public site uses an API key instead, so this group is currently a placeholder |

#### Initial Setup

```
1. Generate project with `npx create-ampless@beta`
2. Deploy with `npx ampx sandbox` (dev) or via Amplify Hosting (prod)
3. Sign up on the admin login screen → Cognito emails a confirmation code
4. Enter the code; the post-confirmation trigger checks whether the admin group is empty
   and, if so, promotes this user to `ampless-admin`
5. Subsequent sign-ups land in the implicit reader state and must be promoted by an admin
```

The post-confirmation trigger ([`packages/backend/src/auth/post-confirmation.ts`](../../packages/backend/src/auth/post-confirmation.ts)) only promotes the **first** confirmed user — the rest of the workflow is admin-driven.

#### User Management

Admin → Users in the admin UI lists Cognito users and lets admins flip a user's role between `admin` / `editor` / `none`. The page calls AppSync queries / mutations (`listAdminUsers` / `setAdminUserRole`) backed by the user-admin Lambda ([`packages/backend/src/auth/user-admin.ts`](../../packages/backend/src/auth/user-admin.ts)). The Lambda uses Cognito Admin APIs (`ListUsers`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`) — no custom user table.

| Operation | Who | Mechanism |
|---|---|---|
| First admin | Initial setup only | Post-confirmation Lambda trigger |
| Sign up | Anyone (or invitee) | Cognito sign-up + email confirmation |
| Assign / change role | admin | `setAdminUserRole` → Cognito `AdminAddUserToGroup` / `AdminRemoveUserFromGroup` |
| List users | admin | `listAdminUsers` → Cognito `ListUsers` |
| Self-promotion | (blocked) | The `listAdminUsers` / `setAdminUserRole` GraphQL ops require `ampless-admin` membership |

#### Permission Boundary

Every server-side mutation either runs under Cognito group authorization (admin/editor) or under the MCP Lambda's IAM role (see below). There is no in-browser path that bypasses AppSync's authorization.

| Source | Auth mode | Effective role |
|---|---|---|
| Admin UI | Cognito User Pool | From `cognito:groups` (`admin` or `editor`) |
| Public site / theme components | AppSync API key | Read-only, restricted to the `listPublishedPosts` / `getPublishedPost` / `listPostsByTag` custom resolvers (drafts stripped) |
| MCP HTTP handler | IAM SigV4 via `allow.resource(mcpHandler)` | Equivalent to admin for the models the resource grant covers |

#### Editor Trust Model (Specification)

In ampless, `editor` is treated as a **trusted principal**. Following the same philosophy as WordPress's `unfiltered_html` capability, **editors can save arbitrary HTML / JavaScript as post body content** — this is a deliberate design decision.

Specifically:

- The `body` field of a Post is not sanitized server-side
  - No sanitization for any of `format: 'tiptap' | 'markdown' | 'html'`
  - tiptap attributes (`href`, `src`, `alt`, `title`, etc.) are also not sanitized
  - `<script>` tags, `javascript:` URIs, and event handler injection via attribute breakout are all preserved as-is and rendered into HTML by the server-side renderer ([`packages/runtime/src/rendering.ts`](../../packages/runtime/src/rendering.ts))
- As a result, an editor can **execute arbitrary JavaScript in any browser that views a public post (including admin browsers)**
- This is an explicit choice to keep editor expressive (embedded widgets, campaign pages with custom scripts, HTML email templates, etc.) rather than locking them to "content CRUD only"

**Operational implications:**

- **Grant editor only to individuals trusted at the same level as admins.** For untrusted users, leave them in the implicit reader state, or isolate them in a separate Cognito User Pool (separate Amplify deploy).
- If an editor acts maliciously, the upper bound is equivalent to `admin` — an editor can steal an admin's Cognito JWT from localStorage via a published post and operate AppSync as admin.
- An **opt-in sanitization plugin** (DOMPurify-based) is planned. Rather than changing the schema, it will rewrite the body via a `before:content.update` hook — operators who want WordPress-like editor sandboxing can install it.

**Handling in security reviews:**

Findings whose threat model assumes a malicious editor (editor-to-admin escalation via stored XSS, JWT leakage, arbitrary `<script>` via `format: 'html'`) are **by design, not vulnerabilities**. During reviews, exclude these explicitly. Real vulnerabilities are:

- Paths by which an unauthenticated principal can perform editor-level writes
- Server-side errors that drop write integrity (broken DynamoDB transactions, race-induced corruption of denormalized GSI keys, dispatcher dropping events without DLQ)
- Server-side RCE, secret leakage, or IAM privilege escalation that does not go through an admin/operator

### MCP Server — Transport and Tool Registry

MCP access is **HTTP-only**. The system is split across two packages:

```
packages/
  mcp-server/         — Tool registry library (private, bundled into the Lambda)
  backend/
    src/functions/
      mcp-handler.ts          — Lambda entry: HTTP + JSON-RPC + Bearer auth
      mcp-graphql-client.ts   — AppSync client (SigV4) for tool handlers
      mcp-storage-client.ts   — S3 client for tool handlers
      mcp-static-bundle.ts    — Zip extraction shared by the bundle tools
```

#### HTTP Transport ([`packages/backend/src/functions/mcp-handler.ts`](../../packages/backend/src/functions/mcp-handler.ts))

The MCP transport is a Lambda Function URL with Bearer token authentication. JSON-RPC 2.0 wire format; the handler implements `initialize`, `tools/list`, and `tools/call` directly (no MCP SDK in the Lambda — overkill for three verbs).

```
MCP client → HTTPS POST to Lambda Function URL
               Authorization: Bearer amk_<base64url>
                 └── SHA-256 hash → GetItem on McpToken table (admin-only model)
                       └── reject if missing / revoked / expired
                             └── dispatchToolCall (@ampless/mcp-server/tools)
                                   ├── AppSync via SigV4 (IAM)
                                   └── S3 via Lambda execution role
```

- **Token format:** `amk_` prefix followed by a base64url-encoded random value.
- **At rest:** Only the SHA-256 hex of the plaintext is stored — token validation is one `GetItem` against the `McpToken` table; AppSync is not touched in the auth path.
- **Token issuance:** Admin UI at `/admin/mcp-tokens`. The McpToken AppSync model is `admin`-only, so editors can't mint tokens.
- **Effective authorization:** Tokens themselves carry no per-token role — they authenticate the holder, and the Lambda's IAM role is the security boundary. The schema's `allow.resource(mcpHandler).to(['query', 'mutate'])` grant is applied **at schema scope, not per-model**: every model declared in the AppSync schema is reachable from the MCP Lambda's IAM principal, including all currently-declared models and any added later. Concrete current scope at the time of writing:
   - The built-in CMS models (Post, Page, PostTag, Media, Taxonomy, KvStore)
   - `McpToken` (token issuance + revocation metadata)
   - `PluginSecret` and `PluginSecretIndicator` (the Phase 6a secret-storage tables — see the precedent note below for why the model-level Cognito-group sentinel does NOT block the MCP Lambda)
   - Any custom models added by the template's [`amplify/data/resource.ts`](../../templates/_shared/amplify/data/resource.ts) via `customSchemaModels(a)`
   - Any model added by future patches to `amplessSchemaModels` in [`packages/backend/src/data/index.ts`](../../packages/backend/src/data/index.ts)

   The schema-wide grant is intentional — `@aws-amplify/data-schema` only honours `allow.resource(...)` at schema scope (model-level callbacks strip `resource` out of `allow`), so per-model resource auth is structurally unavailable in Amplify Gen 2.

   The current MCP tool registry does **not** expose raw GraphQL and does not include any tool that touches McpToken / PluginSecret / PluginSecretIndicator, so a token holder has no operational path to those models today. But the IAM grant is broader than the registry — if a new MCP tool is added that wraps `client.models.PluginSecret.list(...)` (or similar), the AppSync request will succeed under the current grant. Therefore: **possessing an MCP token = admin-equivalent IAM access to the entire AppSync schema, present and future.** Issue them carefully, and treat any new MCP tool that reads a sensitive model as a deliberate scope expansion.

   When adding a new sensitive model to the AppSync schema, decide deliberately whether the MCP Lambda should reach it. Two paths are available:
   - Move that model's persistence off AppSync entirely (Lambda direct DDB SDK + IAM grant on the Lambdas that legitimately need it, AppSync auth set to a placeholder Cognito group with no members — the pattern used for `PluginSecret` in Phase 6a).
   - Add a CI guard that diffs `amplessSchemaModels` against an allowlist and fails on additions until the docs/threat model are updated.

   ##### Precedent: `PluginSecret`'s placeholder-group pattern (Phase 6a)

   `PluginSecret` declares `allow.groups(['__ampless_internal__'])` as its only model-level auth rule. No Cognito user belongs to that group, so admin/editor browser sessions cannot reach the model via AppSync — that protection is real and is the source of the "Cognito-group-sentinel" framing used elsewhere in this doc and in the source comments.

   But the model-level rule only restricts the **Cognito user-pool auth mode**. The schema-level `allow.resource(mcpHandler).to(['query', 'mutate'])` is enforced under the **IAM (SigV4) auth mode**, which is independent. So the MCP Lambda — and *only* the MCP Lambda among AppSync callers — can still read and write `PluginSecret` via SigV4 today. The reason no plaintext leaks happen is operational, not structural: the MCP tool registry has no `read_plugin_secret` tool. The plugin-secret-handler Lambda goes around AppSync entirely (direct DDB SDK + `grantReadWriteData` IAM on the underlying construct), so even with AppSync access disabled the secret path would still work — that part of the design is independent.

   The honest framing for new sensitive models is therefore: "Cognito user-pool auth is denied via the placeholder group; AppSync IAM auth (and so the MCP Lambda) is denied only as long as the tool registry chooses not to surface the model." A future PR that wires an MCP tool against the model would need to revisit this implicitly. The CI guard above is the structural fix; the placeholder-group pattern alone is not.
- **Payload limit:** Function URL caps invocations at ~6 MB base64-inflated. Large static bundles should be split via the incremental `upload_static_file` / `commit_static_post` tools.

#### Tool Registry ([`packages/mcp-server`](../../packages/mcp-server))

`@ampless/mcp-server` is an **internal library** — `private: true`, not published to npm. It exposes a registry of tool definitions and a `dispatchToolCall(name, args, ctx)` entry point. The Lambda supplies the `ToolContext` (GraphQL client, S3 client, site context); the registry has no transport awareness.

```typescript
import { tools, dispatchToolCall } from '@ampless/mcp-server/tools'
```

#### MCP Tools

The current registry exposes 14 tools ([`packages/mcp-server/src/tools/index.ts`](../../packages/mcp-server/src/tools/index.ts)):

| Tool | Description |
|---|---|
| `list_posts` | List posts with status filter + pagination |
| `get_post` | Fetch a single post by slug or postId |
| `create_post` | Create a post (`format` ∈ tiptap / markdown / html — `static` is rejected) |
| `update_post` | Update a post |
| `delete_post` | Delete a post and clean up its `PostTag` rows |
| `upload_media` | Upload bytes (base64) under `public/media/YYYY/MM/` and create a Media row |
| `list_media` | List Media rows with optional `mimeType` (prefix) / `prefix` / `createdAfter` / `createdBefore` filters + pagination; each row carries a public `url` |
| `search_media` | Substring search across filename / `src` / `mimeType` (walks pages internally up to a cap) |
| `delete_media` | Delete a Media file (S3 object + row) by `mediaId` or `src`; `dryRun: true` previews without deleting |
| `get_schema` | Return the CMS content schema, including notes on `static` posts |
| `upload_static_bundle` | One-shot zip upload — extract, validate, replace S3 prefix, upsert the Post manifest |
| `upload_static_file` | Incrementally write a single file under `public/static/<slug>/` |
| `delete_static_file` | Incrementally delete a file under `public/static/<slug>/` |
| `commit_static_post` | Re-scan the S3 prefix and rebuild the Post manifest (the "save" step after incremental edits) |

`create_post` / `update_post` deliberately reject `format=static` so the manifest can't drift from S3 — the static-bundle tools are the only supported entry point.

### Policy

- The admin UI, public site, and MCP Lambda all read/write through the **same** AppSync schema, with different auth modes per caller.
- MCP transport is HTTP-only.
- A first-class REST API is not in scope — anyone needing a non-MCP machine endpoint should issue queries directly against AppSync.

---
