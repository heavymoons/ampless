import { redirect } from 'next/navigation'
import type { Admin } from '../index.js'
import { I18nProvider } from '../components/i18n-provider.js'
import { Sidebar } from '../components/sidebar.js'
import { SiteSelector } from '../components/site-selector.js'
import { AdminProviders } from '../components/admin-providers.js'

/**
 * Build the admin layout component. Wraps every admin route with:
 *
 * - An auth gate (`redirect('/login')` if the visitor isn't in the
 *   `ampless-admin` or `ampless-editor` Cognito group).
 * - The admin sidebar (with optional multi-site selector).
 * - An i18n provider hydrated from the resolved locale dict.
 * - A client-side `AdminProviders` shell that configures the Amplify
 *   SDK and installs the admin's posts / kv providers once on mount.
 */
export function createAdminLayout(admin: Admin) {
  async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await admin.getServerSession()
    if (!admin.isEditor(session)) {
      redirect('/login')
    }

    const sites = admin.adminSiteOptions()
    const currentSiteId = await admin.currentAdminSiteId()
    const selector =
      sites.length > 0 ? <SiteSelector current={currentSiteId} sites={sites} /> : null

    return (
      <AdminProviders outputs={admin.outputs} cmsConfig={admin.cmsConfig}>
        <I18nProvider locale={admin.locale} dict={admin.dict}>
          <div className="flex min-h-screen">
            <Sidebar email={session!.email} siteSelector={selector} />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </I18nProvider>
      </AdminProviders>
    )
  }
  return AdminLayout
}
