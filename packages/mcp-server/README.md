> 日本語版: [README.ja.md](./README.ja.md)
> 

# @ampless/mcp-server

MCP tool registry for [ampless](https://github.com/heavymoons/ampless).

**No direct install needed.** This package is consumed by `@ampless/backend`'s `mcp-handler` Lambda via the `./tools` subpath export, and arrives transitively when you install `@ampless/admin` or `@ampless/backend`.

## How it fits together

```
Admin MCP:  client (.mcp.json) ── Bearer amk_… ──▶ mcp-handler Lambda (@ampless/backend)
                                                     ├── @ampless/mcp-server/tools    (admin tool registry)
                                                     └── @ampless/mcp-server/jsonrpc  (shared JSON-RPC dispatch)

Public MCP: anonymous client ──────────────────▶ /api/mcp route (@ampless/runtime)
                                                     ├── @ampless/mcp-server/public   (read-only tools)
                                                     └── @ampless/mcp-server/jsonrpc  (shared JSON-RPC dispatch)
```

The admin `mcp-handler` Lambda resolves the Bearer token against the `McpToken` AppSync model (admin-only), builds a `ToolContext` (GraphQL client + S3 client + site context), and runs each request through the shared `dispatchJsonRpc` over the admin `tools` registry. The public runtime route injects a read-only `PublicToolContext` and runs the same `dispatchJsonRpc` over `publicTools` — no token, published posts only.

End users configure MCP via the admin UI:

1. Go to `/admin/mcp-tokens` and issue a Bearer token (`amk_...`).
2. Find the `mcp-handler` Lambda Function URL in the Amplify console or `amplify_outputs.json`.
3. Add an entry to your MCP client's config (`.mcp.json`, `claude_desktop_config.json`, etc.):

```json
{
  "mcpServers": {
    "ampless": {
      "url": "https://<function-url-id>.lambda-url.<region>.on.aws/",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer amk_..."
      }
    }
  }
}
```

See `docs/architecture/04-access-layer-mcp.md` for the full HTTP MCP architecture.

## Exports

Three subpath entries:

| Subpath | Purpose |
|---|---|
| `@ampless/mcp-server/tools` | Admin tool registry (token-authenticated, full read/write) |
| `@ampless/mcp-server/jsonrpc` | Transport-agnostic JSON-RPC 2.0 dispatch shared by both endpoints |
| `@ampless/mcp-server/public` | Read-only public tools (anonymous, published posts only) |

### `./tools`

```typescript
import { getTools, dispatchToolCall } from '@ampless/mcp-server/tools'
import type { ToolDefinition, ToolContext, ResolvedSite } from '@ampless/mcp-server/tools'
```

| Export | Description |
|---|---|
| `tools` / `getTools()` | The admin `ToolDefinition[]` registry |
| `dispatchToolCall(name, args, ctx)` | Look up a tool by name and invoke its handler (returns `null` if unknown) |
| `ToolDefinition<TCtx>` | A single tool (name, description, inputSchema, handler, `readOnly?`, `destructive?`) |
| `ToolContext` | Admin runtime context (graphql, storage, site) |
| `ResolvedSite` | Resolved site context (name, url, environment, siteId) |

### `./jsonrpc`

```typescript
import { dispatchJsonRpc } from '@ampless/mcp-server/jsonrpc'
import type { JsonRpcRequest, JsonRpcResponse } from '@ampless/mcp-server/jsonrpc'
```

| Export | Description |
|---|---|
| `dispatchJsonRpc(req, opts)` | Runs one JSON-RPC request against a tool registry (`initialize` with protocol negotiation, `tools/list` with annotations, `tools/call`, notification handling). A notification (`id` absent) still executes the method but returns `null` instead of a response; `id: null` / fractional ids are rejected as `INVALID_REQUEST`. |
| `jsonRpcResult` / `jsonRpcError` / `JSON_RPC_*` | Envelope helpers + standard error codes |
| `SUPPORTED_PROTOCOL_VERSIONS` | `['2025-03-26', '2024-11-05']` |

### `./public`

```typescript
import { publicTools } from '@ampless/mcp-server/public'
import type { PublicToolContext } from '@ampless/mcp-server/public'
```

| Export | Description |
|---|---|
| `publicTools` | The four read-only `ToolDefinition<PublicToolContext>` tools |
| `PublicToolContext` | The minimal read-only surface the runtime injects (`listPublishedPosts` / `getPublishedPost` / `postToMarkdown`) |
| `toPublicSummary` | Explicit field-allowlist projection of a `Post` |

## Tools

### Admin (`./tools`, token-authenticated)

| Tool | Role | Description |
|---|---|---|
| `list_posts` | reader | Lightweight post summaries (no body — use `get_post`) with search / sort / filters. Returns `{ posts, total, offset, limit }` |
| `get_post` | reader | Fetch a single post by slug or postId |
| `create_post` | editor | Create a new post (draft or published) |
| `update_post` | editor | Patch fields on an existing post |
| `delete_post` | editor | Delete a post and clean up its tag index |
| `upload_media` | editor | Upload base64-encoded bytes to S3 and create a Media record |
| `list_media` | reader | List media with optional `mimeType` (prefix) / `prefix` / `createdAfter` / `createdBefore` filters + pagination |
| `search_media` | reader | Search media by substring across filename / `src` / `mimeType` |
| `delete_media` | editor | Delete a media file (S3 object + Media row). Pass `mediaId` or `src`; `dryRun: true` previews |
| `get_schema` | reader | Return the CMS content schema |
| `upload_static_bundle` | editor | Upload a pre-built static bundle (zip) to S3 in one shot |
| `upload_static_file` | editor | Incrementally write a single file into a static bundle's S3 prefix |
| `delete_static_file` | editor | Incrementally delete a file from a static bundle's S3 prefix |
| `commit_static_post` | editor | Rebuild the Post manifest from the S3 prefix (the "save" step) |

### Public (`./public`, anonymous, published posts only)

| Tool | Description |
|---|---|
| `list_posts` | One page of newest-first published-post summaries + opaque `nextCursor` |
| `get_post` | A single published post by slug, body rendered to `markdown` (truncated past 100k chars) |
| `search_posts` | Case-insensitive substring over title / slug / tags / excerpt across a bounded scan |
| `list_tags` | Tag occurrence counts (descending) over the same bounded scan |
