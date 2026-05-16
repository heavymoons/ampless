import { admin } from '@/lib/admin'
import { createSiteEditPage } from '@ampless/admin/pages'

export const dynamic = 'force-dynamic'
export default createSiteEditPage(admin)
