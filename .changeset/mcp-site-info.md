---
"@ampless/mcp-server": minor
---

Add site-context awareness to the MCP server: `--site-name`, `--site-url`, `--environment`, and `--site-id` flags (plus matching env vars) let operators identify which site an MCP server instance targets. When set, the server name, tool descriptions, and call results all carry site context; destructive tools (`delete_post`, `delete_static_file`, `upload_static_bundle`) require a `confirmSite` argument on production environments. Fully backward-compatible — all flags are optional.
