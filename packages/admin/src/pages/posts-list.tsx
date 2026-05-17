import { PostsList } from '../components/posts-list-view.js'

/**
 * Posts list. The view is a client component — this factory module
 * stays server-side so `@ampless/admin/pages` can be imported from
 * Server Components and the `'use client'` boundary is preserved at
 * the cross-file reference.
 */
export function createPostsListPage(_admin: unknown) {
  return PostsList
}
