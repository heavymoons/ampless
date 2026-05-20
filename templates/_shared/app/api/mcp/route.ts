import { admin } from '@/lib/admin'
import { createMcpRoute } from '@ampless/admin/api'

// `force-dynamic` keeps CloudFront from caching MCP responses. Each
// tool call must hit the SSR Lambda — caching would serve stale or
// cross-token responses.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const { POST } = createMcpRoute(admin)
