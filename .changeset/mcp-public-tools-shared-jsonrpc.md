---
"ampless": minor
"@ampless/mcp-server": minor
"@ampless/backend": patch
"@ampless/runtime": patch
---

Public read-only MCP tools + shared JSON-RPC dispatch + `tools/list` annotations.

**`ampless`** (minor): new `collectBounded<T>` bounded cursor-paging helper — walks a
`{ items, nextToken }` fetcher until it has `limit` items, capped by `pageSizeCap` /
`maxPages` with duplicate-token protection. Arguments must be finite positive integers
(`TypeError` otherwise; callers clamp before calling). Lifted from the runtime's llms.txt
walk so the public MCP tools can share the exact semantics.

**`@ampless/mcp-server`** (minor): two new subpath exports.
- `./jsonrpc` — transport-agnostic `dispatchJsonRpc` shared by the admin and public
  endpoints: `initialize` protocol-version negotiation
  (`SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05']`), `tools/list` MCP
  annotations (`readOnlyHint` / `destructiveHint`), and correct notification handling.
- `./public` — four read-only tools (`list_posts` / `get_post` / `search_posts` /
  `list_tags`) over a `PublicToolContext`, published posts only, with a strict field
  allowlist (never emits `postId` / `status` / `metadata` / `body`) and bounded scans.
- `./tools` — `ToolDefinition` is now generic over its context (`ToolDefinition<TCtx>`,
  default `ToolContext`, backward compatible) and gains a `readOnly?` flag; all 14 admin
  tools are explicitly classified read / additive-write / overwriting-write / destructive.

**`@ampless/backend`** (patch): the `mcp-handler` Lambda now delegates to the shared
`@ampless/mcp-server/jsonrpc` dispatch instead of its own inline copy. Three intended
wire-behaviour changes on the admin endpoint:
- `tools/list` now includes MCP `annotations` (`readOnlyHint` / `destructiveHint`) per tool.
- `initialize` now negotiates `protocolVersion` (echo a supported request, else fall back
  to `2025-03-26`); a **missing** `protocolVersion` is now an `INVALID_PARAMS` error.
- `notifications/initialized` (and any JSON-RPC notification with no `id`) now returns
  `202 Accepted` with an empty body instead of a (protocol-violating) result.

**`@ampless/runtime`** (patch): the `/llms.txt` route's internal post walk now uses the
shared `collectBounded` helper. Output is byte-for-byte unchanged.
