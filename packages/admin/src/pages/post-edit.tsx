import { EditPostPage } from '../components/edit-post-view.js'
import { loadEditorTableClasses } from './table-classes.js'

/**
 * Options for `createEditPostPage`.
 *
 * `previewEndpoint` lets the template override the URL that
 * `<PostForm>` / `<PostHistoryPanel>` POST the draft to for preview
 * HTML. Defaults to `/admin/preview`, the Route Handler shipped by
 * the scaffold at `app/(admin)/admin/preview/route.tsx`. Override
 * when the admin route group is mounted at a non-default path (e.g.
 * Next.js `basePath` or a custom prefix).
 */
export interface CreateEditPostPageOptions {
  previewEndpoint?: string
}

/**
 * Edit post page. The view is a client component — this factory module
 * stays server-side so `@ampless/admin/pages` can be imported from
 * Server Components and the `'use client'` boundary is preserved at
 * the cross-file reference.
 *
 * The first argument is the `createAdmin(...)` object the templates
 * already pass. It is used (server-side, per request) to read the active
 * theme's table custom classes for the editor's table controls; anything
 * without `loadThemeConfig` simply yields no offered classes.
 */
export function createEditPostPage(
  admin: unknown,
  opts: CreateEditPostPageOptions = {},
) {
  const { previewEndpoint } = opts
  return async function EditPostPageWrapper(props: {
    params: Promise<{ postId: string }>
  }) {
    const tableClasses = await loadEditorTableClasses(admin)
    return <EditPostPage {...props} previewEndpoint={previewEndpoint} tableClasses={tableClasses} />
  }
}
