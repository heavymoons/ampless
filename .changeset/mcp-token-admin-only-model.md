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

The `McpToken` model uses `issuedAt` for the creation timestamp so it
doesn't collide with Amplify's auto-managed `createdAt` column.
