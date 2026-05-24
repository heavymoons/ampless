---
'@ampless/admin': minor
'@ampless/backend': minor
---

Move MCP HTTP token storage from the shared `KvStore` model to a new
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
