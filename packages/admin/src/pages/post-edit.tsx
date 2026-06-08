import { EditPostPage } from '../components/edit-post-view.js'

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
 * The first argument is intentionally ignored — the factory existed
 * before there was anything to hand it, and we kept the signature
 * stable so existing templates don't need to remove the `admin` arg.
 * The `opts.previewEndpoint` is the only piece the factory actually
 * consumes today.
 */
export function createEditPostPage(
  _admin: unknown,
  opts: CreateEditPostPageOptions = {},
) {
  const { previewEndpoint } = opts
  return function EditPostPageWrapper(props: {
    params: Promise<{ postId: string }>
  }) {
    return <EditPostPage {...props} previewEndpoint={previewEndpoint} />
  }
}
