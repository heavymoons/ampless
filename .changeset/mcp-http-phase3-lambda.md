---
"@ampless/backend": minor
"create-ampless": patch
---

v0.2 MCP HTTP transport — Phase 3 (Lambda + Bearer validation).

Add a dedicated `mcp-handler` Lambda exposed via a Function URL. The
handler validates the `Authorization: Bearer amk_...` token against
the KvStore table directly (PK `mcp-tokens`, SK SHA-256 hash) using
its own IAM-scoped role — no Cognito identity involved.

Phase 3 only handles authentication. The body is a stub (200 OK with
`{ ok, tokenPrefix, scope }` on valid auth, 401 with a discriminated
error code on missing/invalid/revoked/expired token). The MCP
JSON-RPC envelope and tool dispatch land in Phase 4, when AppSync
IAM auth gets wired up so the handler can read posts / write media.

The Function URL is published as a backend output so the admin UI
and external MCP clients can discover the endpoint.

Template scaffolding adds the new function shell at
`amplify/functions/mcp-handler/`. Existing projects pick it up via
`npm run update-ampless`.
