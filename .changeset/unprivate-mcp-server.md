---
"@ampless/mcp-server": patch
---

Restore npm publishing for `@ampless/mcp-server`. The package is the tool registry imported by `@ampless/admin` and `@ampless/backend` as a regular dependency, so it must be resolvable from the npm registry for downstream `npm install` to succeed.
