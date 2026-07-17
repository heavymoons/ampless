import { ampless } from '@/lib/ampless'
import { createMcpDiscoveryRouteHandlers } from '@ampless/runtime/routes'

// Internal target of the `/.well-known/mcp/catalog.json` middleware
// rewrite (experimental MCP discovery). Only active when both
// `cms.config.ai.publicMcp` and `ai.mcpDiscovery` are true; otherwise 404.
export const dynamic = 'force-dynamic'
const handlers = createMcpDiscoveryRouteHandlers(ampless)
export const GET = handlers.catalog.GET
export const OPTIONS = handlers.catalog.OPTIONS
