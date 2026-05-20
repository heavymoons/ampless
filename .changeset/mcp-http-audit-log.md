---
"@ampless/admin": patch
---

Add structured per-token audit logging to `/api/mcp`.

AppSync and S3 audit logs (CloudTrail) show every MCP-driven call as
the shared service Cognito user — the AWS layer can't distinguish
which Bearer token triggered which operation. The SSR Lambda's own
CloudWatch Logs are the only place per-token attribution survives, so
the HTTP route now emits one-line JSON events at every meaningful
transition:

`mcp.auth_failed` (missing / malformed / revoked Bearer token),
`mcp.tool_call` (start, with token label + role + tool name + arg
keys), `mcp.tool_ok` / `mcp.tool_failed` (end, with `durationMs`),
plus `mcp.tool_unsupported` / `mcp.role_denied` / `mcp.tool_unknown`
for the rejection branches.

Plaintext tokens are never logged — only a 12-character
`tokenHashPrefix` for forensic search. Argument **keys** are logged
but not their **values**, so post bodies, PII, or other sensitive
payloads don't leak into CloudWatch indefinitely.

A CloudWatch Logs Insights starter query lives in
`docs/mcp-http-setup.md`.
