---
"@ampless/admin": minor
"create-ampless": patch
---

Remove the unreleased HTTP MCP transport.

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
