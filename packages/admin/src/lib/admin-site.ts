import { cookies } from 'next/headers'
import { DEFAULT_SITE_ID, isMultiSite, siteFor, type Config } from 'ampless'
import { ADMIN_SITE_COOKIE } from './admin-site-client.js'

/**
 * Active siteId in the admin panel.
 *
 * - Single-site mode: always `DEFAULT_SITE_ID`.
 * - Multi-site mode: cookie value if it points to a declared site, else
 *   the first site in `cms.config.sites` declaration order.
 *
 * The setter lives in `<SiteSelector>` (client component) because it
 * writes the cookie via `document.cookie` and triggers `router.refresh()`.
 */
export function createAdminSite(cmsConfig: Config) {
  async function currentAdminSiteId(): Promise<string> {
    if (!isMultiSite(cmsConfig)) return DEFAULT_SITE_ID

    const sites = cmsConfig.sites ?? {}
    const c = await cookies()
    const v = c.get(ADMIN_SITE_COOKIE)?.value
    if (v && sites[v]) return v

    const first = Object.keys(sites)[0]
    return first ?? DEFAULT_SITE_ID
  }

  /**
   * Site list for the selector UI. Empty in single-site mode (no selector
   * is rendered).
   */
  function adminSiteOptions(): Array<{ id: string; name: string }> {
    if (!isMultiSite(cmsConfig)) return []
    return Object.entries(cmsConfig.sites ?? {}).map(([id]) => ({
      id,
      name: siteFor(id, cmsConfig).name,
    }))
  }

  return { currentAdminSiteId, adminSiteOptions }
}
