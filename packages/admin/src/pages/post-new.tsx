import { NewPostPage } from '../components/new-post-view.js'
import { loadEditorTableClasses } from './table-classes.js'

/**
 * Options for `createNewPostPage`.
 *
 * `previewEndpoint` lets the template override the URL that
 * `<PostForm>` POSTs the draft to for preview HTML. Defaults to
 * `/admin/preview`, the Route Handler shipped by the scaffold at
 * `app/(admin)/admin/preview/route.tsx`. Override when the admin
 * route group is mounted at a non-default path (e.g. Next.js
 * `basePath` or a custom prefix).
 */
export interface CreateNewPostPageOptions {
  previewEndpoint?: string
}

/**
 * New post page. The view is a client component — this factory module
 * stays server-side so `@ampless/admin/pages` can be imported from
 * Server Components and the `'use client'` boundary is preserved at
 * the cross-file reference.
 *
 * The first argument is the `createAdmin(...)` object, used the same way
 * as in `createEditPostPage` (active theme's table custom classes).
 */
export function createNewPostPage(
  admin: unknown,
  opts: CreateNewPostPageOptions = {},
) {
  const { previewEndpoint } = opts
  return async function NewPostPageWrapper() {
    const tableClasses = await loadEditorTableClasses(admin)
    return <NewPostPage previewEndpoint={previewEndpoint} tableClasses={tableClasses} />
  }
}
