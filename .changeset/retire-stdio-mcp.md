---
"@ampless/mcp-server": major
---

Retire the stdio MCP CLI. The package is now an internal tool registry
consumed only by `@ampless/backend`'s mcp-handler Lambda; the HTTP MCP
transport (token + Function URL) is the only supported path.

Removed:
- `bin: ampless-mcp` CLI entry
- `.` export (only `./tools` remains)
- Stdio server, Cognito SRP auth, AppSync client, S3 client
- Dependencies on `@modelcontextprotocol/sdk`,
  `amazon-cognito-identity-js`, `@aws-sdk/client-s3`

The package is now `private: true` and will no longer publish to npm.
