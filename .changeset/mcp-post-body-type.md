---
"@ampless/mcp-server": patch
---

fix(mcp-server): declare a `type` on the `body` input of `create_post` / `update_post`

The `body` property had no JSON-Schema `type`, so MCP clients (Claude Code) coerced every body to a string — a tiptap JSON object could not be sent as an object. `body` now accepts `["object", "array", "string"]` so tiptap JSON is passed as-is while markdown / html stay strings.
