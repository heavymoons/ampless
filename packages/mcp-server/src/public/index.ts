// Public read-only MCP tools. Injected with a `PublicToolContext` by
// the runtime's `/api/mcp` route (PR-8) — this package stays
// transport-agnostic and depends only on `ampless` (never on the
// runtime).
//
// All four tools are read-only over published posts. They never expose
// `postId` / `status` / `metadata` / raw `body` (see `toPublicSummary`).

import type { ToolDefinition } from '../tools/index.js'
import type { PublicToolContext } from './types.js'
import { listPostsTool } from './list-posts.js'
import { getPostTool } from './get-post.js'
import { searchPostsTool } from './search-posts.js'
import { listTagsTool } from './list-tags.js'

export type { PublicToolContext, PublicPostSummary } from './types.js'
export { toPublicSummary } from './types.js'

export const publicTools: readonly ToolDefinition<PublicToolContext>[] = [
  listPostsTool,
  getPostTool,
  searchPostsTool,
  listTagsTool,
]
