---
"@ampless/mcp-server": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"@ampless/plugin-ai-actions": patch
---

Expose explicitly client-safe MCP validation and not-found failures through `ToolUserError` while continuing to mask and log unexpected exceptions. Advertise the opt-in public read-only MCP endpoint in `llms.txt` and the admin MCP tokens page, with updated connection guidance.
