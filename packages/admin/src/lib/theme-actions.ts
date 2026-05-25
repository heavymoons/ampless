'use server'

import { revalidateTag } from 'next/cache'

/**
 * Force-invalidate the Next.js fetch cache for the site settings JSON.
 * Used by the admin theme switcher: writes to KvStore propagate to S3
 * via the trusted processor (~5-10s), and without this call the
 * `revalidate: 60` on the public-side fetch would keep serving the old
 * cached response for up to a minute after the rebuild.
 *
 * The cache tag matches the one used in `theme-active.ts` and
 * `theme-config.ts` (in `@ampless/runtime`): `site-settings`.
 *
 * Uses `revalidateTag(tag, 'max')` rather than `updateTag(tag)`:
 * `updateTag` was introduced in Next.js 16 and is gated on a
 * `workStore.page.endsWith('/route')` check that misfires when a
 * server action is invoked from a `setTimeout` callback inside a
 * client component (the admin theme-settings form does exactly that
 * — it waits 8s before invalidating so the trusted processor has
 * time to rebuild the S3 cache). The misfire surfaces client-side as
 * `An unexpected response was received from the server.` and aborts
 * the post-reload refresh.
 *
 * `revalidateTag` is the older, stable API. Passing `'max'` as the
 * profile silences the "single-arg deprecated" warning while keeping
 * the immediate-invalidation semantics we need — the next fetch tagged
 * `site-settings` goes back to origin instead of serving the
 * 60-second cached response.
 */
export async function invalidateSiteSettingsCache(): Promise<void> {
  revalidateTag('site-settings', 'max')
}
