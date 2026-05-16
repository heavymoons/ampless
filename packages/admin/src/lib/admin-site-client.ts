'use client'

// Client-side helpers for the admin site selector. Kept separate from
// `lib/admin-site.ts` because that module imports `next/headers`, which
// is server-only — importing it from a client component breaks the
// build.
//
// cmsConfig is registered by the admin layout via `setAdminCmsConfig`
// so this module stays a pure client utility that doesn't import the
// project's config directly.

import { DEFAULT_SITE_ID, isMultiSite, type Config } from 'ampless'

export const ADMIN_SITE_COOKIE = 'admin-site-id'

let cmsConfig: Config | null = null

/**
 * Register the cms.config for client-side multi-site lookups. Called
 * once from the admin layout factory.
 */
export function setAdminCmsConfig(config: Config): void {
  cmsConfig = config
}

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
  if (!cmsConfig) return DEFAULT_SITE_ID
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
