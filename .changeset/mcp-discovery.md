---
"ampless": minor
"@ampless/runtime": minor
"create-ampless": patch
"@ampless/plugin-ai-actions": patch
---

Add experimental MCP discovery (well-known catalog + Server Card) for the public read-only MCP endpoint.

- **ampless**: new `AiConfig.mcpDiscovery?: boolean` (default `false`, experimental). Requires `publicMcp: true` + an `http(s)` `site.url`.
- **@ampless/runtime**: new `createMcpDiscoveryRouteHandlers` serving `/.well-known/mcp/catalog.json` (via a middleware rewrite to the dot-free internal `/api/mcp/catalog.json`) and `/api/mcp/server-card`, following the prototype `experimental-ext-server-card` spec (SEP-2127, still open/unmerged — schema/paths may change). `.well-known` becomes a reserved middleware prefix so other `/.well-known/*` paths pass straight through to Next (previously they cost a wasted AppSync flag query + a middleware 404; behaviour is equivalent for callers).

  **Wire change (only when `ai.mcpDiscovery` is on):** the `/api/mcp` `initialize` response's `serverInfo` switches from the static `{ name: "ampless-mcp", version: "0.2" }` to a site-derived reverse-DNS identity (`{ name: "<reverse-dns>/ampless-mcp", version: "0.2.0" }`) so it matches the Server Card. Tool behaviour, error shapes, and response structure are unchanged. Sites with `mcpDiscovery` off (the default) are fully unchanged, including no extra settings fetch.
- **create-ampless**: scaffolds the two thin discovery route delegates (`app/api/mcp/catalog.json/route.ts`, `app/api/mcp/server-card/route.ts`) and documents `mcpDiscovery` in `cms.config.ts`.
- **@ampless/plugin-ai-actions**: README note — the deferred on-page MCP link/QR affordance is dropped in favour of the new machine discovery + docs.

See `docs/mcp.md` for enabling it, client connection examples (Claude Code / Cursor / VS Code), and MCP Registry publishing.
