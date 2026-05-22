---
"@ampless/mcp-server": patch
"@ampless/backend": patch
---

Fix `create_post` / `update_post` failing with **"Variable 'body' has an invalid value."** for markdown / html posts.

`encodeBody` in `mcp-server` returned string values verbatim, so a raw markdown body like `# Hello` was sent to AppSync as a bare string. AppSync's `AWSJSON` scalar rejects that — it requires a JSON-encoded string on the wire (`"# Hello"`, a JSON string literal). tiptap posts happened to work because their object body was always `JSON.stringify`d through the structural branch.

Always `JSON.stringify` regardless of input type, matching the admin posts-provider's existing rule. The `decodeBody` round-trip is unchanged: `JSON.parse('"# Hello"')` → `'# Hello'`.

`@ampless/backend` patches alongside because its `dist/functions/mcp-handler.js` bundles the fixed `mcp-server` tools.
