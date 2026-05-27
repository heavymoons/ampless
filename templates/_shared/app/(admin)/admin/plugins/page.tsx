import { admin } from '@/lib/admin'
import { createPluginsPage } from '@ampless/admin/pages'

export const dynamic = 'force-dynamic'
export default createPluginsPage(admin)
