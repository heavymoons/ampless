// Client-side helpers for the admin site selector. Kept separate from
// `lib/admin-site.ts` because that module imports `next/headers`, which
// is server-only — importing it from a client component breaks the
// build.

export const ADMIN_SITE_COOKIE = 'admin-site-id'

import { DEFAULT_SITE_ID } from 'ampless'

/**
 * Read the active siteId from the cookie set by `<SiteSelector>`.
 * Returns `DEFAULT_SITE_ID` when the cookie is absent (single-site
 * mode, or first-load before the user has chosen a site).
 */
export function readAdminSiteIdFromCookie(): string {
  if (typeof document === 'undefined') return DEFAULT_SITE_ID
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${ADMIN_SITE_COOKIE}=([^;]+)`)
  )
  return match ? decodeURIComponent(match[1]!) : DEFAULT_SITE_ID
}
