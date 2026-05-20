---
"@ampless/mcp-server": minor
"@ampless/admin": minor
"ampless": minor
"create-ampless": patch
---

MCP HTTP transport + per-site access tokens.

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
