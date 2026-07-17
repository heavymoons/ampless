---
"@ampless/mcp-server": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"@ampless/plugin-ai-actions": patch
"ampless": minor
---

Expose explicitly client-safe MCP validation and not-found failures through `ToolUserError` while continuing to mask and log unexpected exceptions. Advertise the opt-in public read-only MCP endpoint in `llms.txt` and the admin MCP tokens page, with updated connection guidance. The endpoint URL normalization (`resolvePublicMcpEndpoint`) now lives in `ampless` core as a shared export, so `llms.txt` and the admin MCP tokens card always agree on when a `site.url` can be turned into a public MCP endpoint.
