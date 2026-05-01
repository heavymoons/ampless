import { redirect } from 'next/navigation'
import { getServerSession, isEditor } from '@/lib/auth-server'
import { Sidebar } from '@/components/admin/sidebar'
import { SiteSelector } from '@/components/admin/site-selector'
import { adminSiteOptions, currentAdminSiteId } from '@/lib/admin-site'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  if (!isEditor(session)) {
    redirect('/login')
  }

  const sites = adminSiteOptions()
  const currentSiteId = await currentAdminSiteId()
  const selector =
    sites.length > 0 ? <SiteSelector current={currentSiteId} sites={sites} /> : null

  return (
    <div className="flex min-h-screen">
      <Sidebar email={session!.email} siteSelector={selector} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
