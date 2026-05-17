import { EditPostPage } from '../components/edit-post-view.js'

/**
 * Edit post page. The view is a client component — this factory module
 * stays server-side so `@ampless/admin/pages` can be imported from
 * Server Components and the `'use client'` boundary is preserved at
 * the cross-file reference.
 */
export function createEditPostPage(_admin: unknown) {
  return EditPostPage
}
