// Client-side helpers for the admin site selector. Kept separate from
// `lib/admin-site.ts` because that module imports `next/headers`, which
// is server-only — importing it from a client component breaks the
// build.

import { DEFAULT_SITE_ID, isMultiSite } from 'ampless'
import cmsConfig from '@/cms.config'

export const ADMIN_SITE_COOKIE = 'admin-site-id'

/**
 * Read the active siteId from the cookie set by `<SiteSelector>`.
 *
 * - Single-site mode: always `DEFAULT_SITE_ID`.
 * - Multi-site mode: the cookie value if it points to a declared site;
 *   otherwise the first site in `cms.config.sites` declaration order.
 *
 * The fallback matches `lib/admin-site.ts:currentAdminSiteId` (server
 * side) so the two never disagree on first load.
 */
export function readAdminSiteIdFromCookie(): string {
  if (!isMultiSite(cmsConfig)) return DEFAULT_SITE_ID

  const sites = cmsConfig.sites ?? {}

  if (typeof document !== 'undefined') {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${ADMIN_SITE_COOKIE}=([^;]+)`)
    )
    if (match) {
      const v = decodeURIComponent(match[1]!)
      if (sites[v]) return v
    }
  }

  const first = Object.keys(sites)[0]
  return first ?? DEFAULT_SITE_ID
}
