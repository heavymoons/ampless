---
"@ampless/admin": minor
---

MCP HTTP transport — Phase 1 (storage layer).

API key generation, hashing, and KvStore-backed CRUD for token
metadata.

New exports from `@ampless/admin/lib`:

- `mcp-token-format.ts` — `generateToken()` produces an `amk_<32-bytes-base64url>`
  plaintext token plus its SHA-256 hash for storage. `hashToken(plain)`
  validates incoming Bearer tokens against the stored hash.
- `mcp-token-storage.ts` — `listTokens`, `findByHash`, `createToken`,
  `revokeToken`, `touchLastUsed` over `getKvStore()` with PK
  `mcp-tokens`. Revocation is a soft delete (`revokedAt` timestamp)
  for audit.

Storage-agnostic: reused from both the SSR route (server KvStore
provider) and the Lambda data path (IAM/SigV4 auth).
