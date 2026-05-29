> 日本語版: [README.ja.md](./README.ja.md)
> 

# @ampless/mcp-server

MCP tool registry for [ampless](https://github.com/heavymoons/ampless).

**No direct install needed.** This package is consumed by `@ampless/backend`'s `mcp-handler` Lambda via the `./tools` subpath export, and arrives transitively when you install `@ampless/admin` or `@ampless/backend`.

## How it fits together

```
MCP client (.mcp.json)
  └── HTTP Bearer token (amk_...)
        └── mcp-handler Lambda (packages/backend/src/functions/mcp-handler.ts)
              └── @ampless/mcp-server/tools  ← this package
                    └── ToolDefinition[], dispatchToolCall
```

The `mcp-handler` Lambda resolves the Bearer token against the `McpToken` AppSync model (admin-only), builds a `ToolContext` (GraphQL client + S3 client + site context), and delegates each incoming tool call to `dispatchToolCall` from this package.

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

### `./tools`

```typescript
import { getTools, dispatchToolCall } from '@ampless/mcp-server/tools'
import type { ToolDefinition, ToolContext, ResolvedSite } from '@ampless/mcp-server/tools'
```

| Export | Description |
|---|---|
| `getTools()` | Returns the list of `ToolDefinition` objects (name, description, inputSchema) |
| `dispatchToolCall(name, args, ctx)` | Dispatches a tool call by name; throws if unknown |
| `ToolDefinition` | Interface for a single tool (name, description, inputSchema, handler) |
| `ToolContext` | Interface for the runtime context (graphql, storage, site) |
| `ResolvedSite` | Interface for the resolved site context (name, url, environment, siteId) |

## Tools

| Tool | Role | Description |
|---|---|---|
| `list_posts` | reader | List posts with optional status filter and pagination |
| `get_post` | reader | Fetch a single post by slug or postId |
| `create_post` | editor | Create a new post (draft or published) |
| `update_post` | editor | Patch fields on an existing post |
| `delete_post` | editor | Delete a post and clean up its tag index |
| `upload_media` | editor | Upload base64-encoded bytes to S3 and create a Media record |
| `delete_media` | editor | Delete a media file (S3 object + Media row). Pass `mediaId` or `src` |
| `get_schema` | reader | Return the CMS content schema |
| `upload_static_bundle` | editor | Upload a pre-built static bundle to S3 |
| `list_static_files` | reader | List static bundle files |
| `delete_static_file` | editor | Delete a static file from S3 |
| `get_site_context` | reader | Return current site context (name, url, environment) |
