import { admin } from '@/lib/admin'
import { createUsersListPage } from '@ampless/admin/pages'

export const dynamic = 'force-dynamic'
export default createUsersListPage(admin)
