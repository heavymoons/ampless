import { admin } from '@/lib/admin'
import { createMcpTokensRoute } from '@ampless/admin/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const { GET, POST, DELETE } = createMcpTokensRoute(admin)
