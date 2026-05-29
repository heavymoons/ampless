---
"@ampless/mcp-server": minor
"@ampless/backend": minor
---

feat(mcp): add list_media / search_media tools, delete_media dryRun, and grant mcp-handler s3:DeleteObject on public/media/*

- `list_media`: list Media rows with optional `mimeType` (prefix), `prefix`, `createdAfter` / `createdBefore` filters + pagination; each row carries a derived public `url`.
- `search_media`: substring search across filename / `src` / `mimeType`, walking DynamoDB pages internally up to a cap (reports `truncated`).
- `delete_media`: new `dryRun` option previews the target without deleting anything.
- `StorageClient` gains `publicUrl(key)` (implemented in the mcp-handler S3 client) so the list/search tools can surface a URL without re-deriving bucket/region.
- backend: the mcp-handler Lambda role now has `s3:DeleteObject` on `public/media/*`, so `delete_media` can actually remove the S3 object (previously it failed with "not authorized to perform s3:DeleteObject"). Requires a redeploy to take effect.
