---
"create-ampless": patch
---

Add `.mcp.json` to the default `.gitignore` written by scaffold and `--mount`, since it holds the MCP Bearer token. The scaffolded AGENTS/README docs now warn not to commit it. Existing projects are not rewritten by `upgrade`: add `.mcp.json` to your `.gitignore` manually (and remove it from git history/revoke the token if it was already committed).
