'use server'

import { updateTag } from 'next/cache'

/**
 * Force-invalidate the Next.js fetch cache for a site's settings JSON.
 * Used by the admin theme switcher: writes to KvStore propagate to S3
 * via the trusted processor (~5-10s), and without this call the
 * `revalidate: 60` on the public-side fetch would keep serving the old
 * cached response for up to a minute after the rebuild.
 *
 * The cache tag matches the one used in `theme-active.ts` and
 * `theme-config.ts` (in `@ampless/runtime`): `site-settings:{siteId}`.
 *
 * Uses `updateTag` (Next 16+) — the read-your-own-writes variant of
 * the old `revalidateTag`, which is the right semantics inside a
 * server action (this entire module is `'use server'`).
 */
export async function invalidateSiteSettingsCache(siteId: string): Promise<void> {
  updateTag(`site-settings:${siteId}`)
}
