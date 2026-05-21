---
"@ampless/admin": minor
---

v0.2 MCP HTTP transport — Phase 1 (storage layer).

Add the foundation for the replacement HTTP MCP transport that the
previous PR removed: API key generation, hashing, and KvStore-backed
CRUD for token metadata.

New exports from `@ampless/admin/lib`:

- `mcp-token-format.ts` — `generateToken()` produces an `amk_<32-bytes-base64url>`
  plaintext token plus its SHA-256 hash for storage. `hashToken(plain)`
  validates incoming Bearer tokens against the stored hash.
- `mcp-token-storage.ts` — `listTokens`, `findByHash`, `createToken`,
  `revokeToken`, `touchLastUsed` over `getKvStore()` with PK
  `mcp-tokens`. Revocation is a soft delete (`revokedAt` timestamp)
  for audit.

No routes / UI / Lambda yet — those come in Phase 2 (dedicated
`mcp-handler` Lambda Function with IAM-scoped AppSync access, admin
UI for token CRUD via the Lambda). Phase 1 is storage-agnostic on
purpose so it can be reused from both the SSR route (when a server
KvStore provider is available) and the Lambda data path (where the
provider authenticates via IAM/SigV4).
