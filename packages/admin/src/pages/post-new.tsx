import { NewPostPage } from '../components/new-post-view.js'

/**
 * New post page. The view is a client component — this factory module
 * stays server-side so `@ampless/admin/pages` can be imported from
 * Server Components and the `'use client'` boundary is preserved at
 * the cross-file reference.
 */
export function createNewPostPage(_admin: unknown) {
  return NewPostPage
}
