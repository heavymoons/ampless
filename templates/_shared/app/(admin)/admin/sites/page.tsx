import { admin } from '@/lib/admin'
import { createSitesListPage } from '@ampless/admin/pages'

export const dynamic = 'force-dynamic'
export default createSitesListPage(admin)
