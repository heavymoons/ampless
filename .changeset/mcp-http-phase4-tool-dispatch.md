---
"@ampless/backend": minor
"create-ampless": patch
---

MCP HTTP transport — Phase 4 (tool dispatch via AppSync IAM auth).

The mcp-handler Lambda parses incoming JSON-RPC 2.0 envelopes
and dispatches `tools/call` through `@ampless/mcp-server/tools`'
shared registry. AppSync IAM auth lets the Lambda read and write
Post / PostTag tables under its own scoped role — no Cognito
identity, no shared API key.

Available over HTTP:

- list_posts / get_post / get_schema (reads)
- create_post / update_post / delete_post (writes)
- Standard JSON-RPC verbs: initialize, tools/list, tools/call

Template `amplify/data/resource.ts` now threads the mcp-handler
function ref into `amplessSchemaModels(a, { mcpHandlerFunction })`,
which gates the `allow.resource(...).to(['query', 'mutate'])` clause
on Post + PostTag. Projects pick it up via `npm run update-ampless`
followed by a redeploy.
