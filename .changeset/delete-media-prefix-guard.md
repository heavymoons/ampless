---
"@ampless/mcp-server": patch
---

Fix `delete_media` tool letting callers delete S3 objects
outside of `public/media/`. Both the orphan-cleanup path (when
`args.src` is supplied but no Media row matches) and the normal
delete path now enforce a `public/media/` prefix on the resolved
S3 key, rejecting `public/static/`, traversal sequences (`..`),
and any other non-media prefix. MCP Lambda role retains delete
permission on both prefixes because other tools legitimately
manage static bundles — `delete_media` was the wrong place to
gate it, but is now correctly scoped at the tool level.
