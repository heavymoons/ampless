---
"@ampless/backend": minor
"create-ampless": patch
---

v0.2 MCP HTTP transport — Phase 4 (tool dispatch via AppSync IAM auth).

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
