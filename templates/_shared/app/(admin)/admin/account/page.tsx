import { admin } from '@/lib/admin'
import { createAccountPage } from '@ampless/admin/pages'

export const dynamic = 'force-dynamic'
export default createAccountPage(admin)
