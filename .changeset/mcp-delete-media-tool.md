---
"@ampless/mcp-server": minor
"@ampless/backend": patch
---

Add `delete_media` MCP tool. Removes the S3 object and the Media row in one call, with the usual idempotent semantics: take either `mediaId` (primary key) or `src` (full S3 key), resolve to a `{ mediaId, src }` pair, S3 DeleteObject first, then the DDB row mutation. When `src` is supplied directly and no matching Media row exists, the S3 object is still removed so the tool can sweep orphan files. The `mcp-handler` Lambda picks up the new entry from the shared `@ampless/mcp-server/tools` registry — no dispatch changes required, only a republish so the new entry ships.
