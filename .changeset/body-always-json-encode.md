---
"@ampless/admin": patch
---

Fix `Variable 'body' has an invalid value` AppSync error when saving a markdown / HTML post.

`encodeBody` short-circuited for string inputs and returned them as-is — but AppSync's AWSJSON scalar requires a JSON-encoded string on the wire. A raw markdown body like `# Hello` is not valid JSON; AppSync's validator rejects it.

Always `JSON.stringify` on encode (including for strings, which become JSON string literals like `"# Hello"`).
