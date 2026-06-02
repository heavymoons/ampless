---
"@ampless/backend": patch
---

Update `lastUsedAt` on the MCP token row after each successful
validation in the MCP handler. The admin UI shows "Last used"
on each token (mcp-tokens-view.tsx) and the McpTokenRow type
comment already promised validator-side updates, but the
handler only did GetItem and the IAM grant only allowed
GetItem — so the column stayed `undefined` indefinitely.

Throttled to one write per token per 60 seconds via a
ConditionExpression (`attribute_not_exists(lastUsedAt) OR
lastUsedAt < :threshold`), so high-frequency MCP requests
don't hammer DDB. Failures during the update do not block the
validation flow (fail-open + console.error) so the MCP request
itself stays correct even if DDB is misbehaving.

IAM policy on the MCP handler Lambda gains
`dynamodb:UpdateItem` on the McpToken table.
