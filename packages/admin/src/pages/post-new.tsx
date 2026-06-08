import { NewPostPage } from '../components/new-post-view.js'

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
 * The first argument is intentionally ignored, same as
 * `createEditPostPage`.
 */
export function createNewPostPage(
  _admin: unknown,
  opts: CreateNewPostPageOptions = {},
) {
  const { previewEndpoint } = opts
  return function NewPostPageWrapper() {
    return <NewPostPage previewEndpoint={previewEndpoint} />
  }
}
