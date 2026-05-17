import { MediaPage } from '../components/media-view.js'

/**
 * Media library page. The view is a client component — this factory
 * module stays server-side so `@ampless/admin/pages` can be imported
 * from Server Components and the `'use client'` boundary is preserved
 * at the cross-file reference.
 */
export function createMediaPage(_admin: unknown) {
  return MediaPage
}
