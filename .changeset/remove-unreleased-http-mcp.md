---
"@ampless/admin": minor
"create-ampless": patch
---

Remove the unreleased HTTP MCP transport.

The previous design required setting `AMPLESS_MCP_SERVICE_EMAIL` /
`AMPLESS_MCP_SERVICE_PASSWORD` as Amplify Hosting environment
variables and provisioning a dedicated Cognito user via the admin
UI — unusable for non-technical operators. None of this code has
shipped (the original `mcp-http-transport` changeset was still
pending), so we're taking it down cleanly before any release picks
it up.

A replacement using API keys + a dedicated Lambda function with
proper IAM scoping is planned for v0.2.

The local stdio MCP (`@ampless/mcp-server` with
`AMPLESS_MCP_EMAIL` / `AMPLESS_MCP_PASSWORD`) is unaffected and
remains the recommended path for individual developers.
