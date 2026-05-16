import { admin } from '@/lib/admin'
import { createSiteThemePage } from '@ampless/admin/pages'
import { themeList } from '@/themes-registry'

export const dynamic = 'force-dynamic'
export default createSiteThemePage(admin, themeList)
