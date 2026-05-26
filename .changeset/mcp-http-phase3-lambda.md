---
"@ampless/backend": minor
"@ampless/admin": patch
"create-ampless": patch
---

MCP HTTP transport — Phase 3 (Lambda + Bearer validation).

Add a dedicated `mcp-handler` Lambda exposed via a Function URL. The
handler validates the `Authorization: Bearer amk_...` token against
the KvStore table directly (PK `mcp-tokens`, SK SHA-256 hash) using
its own IAM-scoped role — no Cognito identity involved.

Phase 3 handles authentication only. On valid auth the response is
200 OK with `{ ok, tokenPrefix, scope }`; invalid/revoked/expired
tokens return 401 with a discriminated error code.

The Function URL is published as a backend output (`custom.mcp.endpoint`
in `amplify_outputs.json`) so the admin UI and external MCP clients
can discover the endpoint. The `/admin/mcp-tokens` page surfaces
the URL with a copy-to-clipboard button alongside the issued tokens.

Template scaffolding adds the new function shell at
`amplify/functions/mcp-handler/`. Projects pick it up via
`npm run update-ampless`.
