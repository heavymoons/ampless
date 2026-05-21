---
"@ampless/admin": patch
---

Fix `/admin/mcp-tokens` and `/api/mcp` failing on deployed sites with **"No KvStore configured. Call setKvStore() during initialization."**.

The existing `installAdminKvProvider` lives in a `'use client'` module, so it only runs in browser sessions of the admin UI. The new MCP HTTP route and MCP token CRUD API run server-side in the SSR Lambda, where the global KvStore was never installed — both blew up on first DynamoDB-backed call.

Add `installServerKvProvider(outputs)` that wires a KvStore implementation talking straight to AppSync over `fetch` using the MCP service user's Cognito id token (the identity `/api/mcp` already uses). Call it at factory time from both `createMcpRoute` and `createMcpTokensRoute`. Route-level auth (admin cookie session for token CRUD, Bearer token for MCP) gates WHO can issue Kv ops; the underlying write identity is always the service user.

The `data.url` and env-var checks stay lazy so a missing AppSync endpoint surfaces as a clear runtime error on the first Kv call rather than crashing the route module at import.
