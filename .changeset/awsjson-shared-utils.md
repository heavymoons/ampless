---
"ampless": minor
"@ampless/admin": patch
"@ampless/backend": patch
"@ampless/mcp-server": patch
"@ampless/runtime": patch
---

Consolidate AppSync `AWSJSON` encode / decode behind shared `encodeAwsJson` / `decodeAwsJson` helpers in `ampless`.

Background: every `a.json()` field (`Post.body`, `Post.metadata`, `Page.body`, `KvStore.value`, …) carries a *JSON-encoded string* on the wire, regardless of whether the underlying value is a string, object, or array. That rule held in five different ad-hoc implementations across `admin`, `runtime`, `mcp-server`, and `backend` — until the `mcp-server` copy diverged, returning string bodies verbatim and tripping AppSync's `Variable 'body' has an invalid value.` validator on markdown / html posts (already patched in the prior fix).

Now there is one implementation and one set of tests in [`packages/ampless/src/awsjson.ts`](packages/ampless/src/awsjson.ts). Callers across the monorepo import it — no more drift.

No behavior change for callers that were already correct; the encode path is now uniformly `JSON.stringify(value ?? null)` and the decode path tolerates both wire shapes (string and the DynamoDB-unmarshalled native value).
