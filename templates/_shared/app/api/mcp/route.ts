import { ampless } from '@/lib/ampless'
import { createPublicMcpRouteHandler } from '@ampless/runtime/routes'

// Anonymous, read-only public MCP endpoint (JSON-RPC 2.0 over POST).
// Only active when `cms.config.ai.publicMcp === true`; otherwise every
// method 404s. The factory returns BOTH handlers — destructure them so
// the CORS preflight (OPTIONS) is wired up too. A single
// `export const POST = createPublicMcpRouteHandler(ampless)` would drop
// OPTIONS.
const handlers = createPublicMcpRouteHandler(ampless)
export const POST = handlers.POST
export const OPTIONS = handlers.OPTIONS

// Node runtime required: the route's circuit breaker is module-scope
// state that only persists on a warm Node lambda.
export const runtime = 'nodejs'
