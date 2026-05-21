import { admin } from '@/lib/admin'
import { createMcpTokensPage } from '@ampless/admin/pages'

export const dynamic = 'force-dynamic'
export default createMcpTokensPage(admin)
