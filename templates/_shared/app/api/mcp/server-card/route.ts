import { ampless } from '@/lib/ampless'
import { createMcpDiscoveryRouteHandlers } from '@ampless/runtime/routes'

// MCP Server Card (experimental discovery) at the spec-recommended
// `<streamable-http-url>/server-card` placement. Only active when both
// `cms.config.ai.publicMcp` and `ai.mcpDiscovery` are true; otherwise 404.
export const dynamic = 'force-dynamic'
const handlers = createMcpDiscoveryRouteHandlers(ampless)
export const GET = handlers.serverCard.GET
export const OPTIONS = handlers.serverCard.OPTIONS
