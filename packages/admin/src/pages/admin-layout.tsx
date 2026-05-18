import { redirect } from 'next/navigation'
import type { Config } from 'ampless'
import type { Admin } from '../index.js'
import { I18nProvider } from '../components/i18n-provider.js'
import { Sidebar } from '../components/sidebar.js'
import { SiteSelector } from '../components/site-selector.js'
import { AdminProviders } from '../components/admin-providers.js'

/**
 * Strip plugin function fields (hooks, metadata, etc.) before sending
 * cmsConfig across the server→client boundary. Plugin instances carry
 * Lambda-side event handlers that React's RSC serializer rejects:
 *
 *   Functions cannot be passed directly to Client Components unless
 *   you explicitly expose it by marking it with "use server".
 *
 * Client state modules only read `cmsConfig.site` / `sites` / `media`
 * — never `plugins[].hooks` — so reducing each plugin instance to its
 * metadata (name / apiVersion / trust_level) is safe.
 */
function sanitizeCmsConfigForClient(config: Config): Config {
  return {
    ...config,
    plugins: (config.plugins ?? []).map((p) =>
      typeof p === 'string'
        ? p
        : { name: p.name, apiVersion: p.apiVersion, trust_level: p.trust_level }
    ) as Config['plugins'],
  }
}

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
      <AdminProviders outputs={admin.outputs} cmsConfig={sanitizeCmsConfigForClient(admin.cmsConfig)}>
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
