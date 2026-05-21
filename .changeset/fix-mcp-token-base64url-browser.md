---
"@ampless/admin": patch
---

Fix `Unknown encoding: base64url` error when issuing an MCP token from
the admin UI.

`generateToken()` runs in the browser (the create-token modal in
`/admin/mcp-tokens`), where Next.js polyfills `node:crypto` via a
Buffer shim that doesn't recognise the `base64url` encoding name —
`Buffer.toString('base64url')` throws even though Node itself supports
it natively. Token creation died on the very first call.

Fix: encode as plain `base64`, then translate to the URL-safe alphabet
by hand (`+` → `-`, `/` → `_`, strip trailing `=`). Byte-identical
output to Node's native `base64url`, works in both runtimes. Added a
URL-safe-only character regression test against the public token API
so future refactors don't reintroduce the issue.
