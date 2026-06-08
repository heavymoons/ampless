import type { Post } from 'ampless'
import { EditPostPage } from '../components/edit-post-view.js'

/**
 * Options for `createEditPostPage`.
 *
 * `renderPreviewAction` is the Phase 7 hook — templates pass a
 * `'use server'` action that renders a draft post into a complete
 * HTML string (body + page-level scripts). The factory wraps the
 * client-side `EditPostPage` so the action threads down to
 * `<PostForm renderPreviewAction={...} />` and `<PostHistoryPanel
 * renderPreviewAction={...} />`. Without it the preview pane shows a
 * fallback message asking the engineer to wire the prop.
 */
export interface CreateEditPostPageOptions {
  renderPreviewAction?: (draft: Post) => Promise<string>
}

/**
 * Edit post page. The view is a client component — this factory module
 * stays server-side so `@ampless/admin/pages` can be imported from
 * Server Components and the `'use client'` boundary is preserved at
 * the cross-file reference.
 *
 * The first argument is intentionally ignored — the factory existed
 * before there was anything to hand it, and we kept the signature
 * stable through Phase 7 so existing templates don't need to remove
 * the `admin` arg. The `opts.renderPreviewAction` is the only piece
 * the factory actually consumes today.
 */
export function createEditPostPage(
  _admin: unknown,
  opts: CreateEditPostPageOptions = {},
) {
  const { renderPreviewAction } = opts
  return function EditPostPageWrapper(props: {
    params: Promise<{ postId: string }>
  }) {
    return (
      <EditPostPage {...props} renderPreviewAction={renderPreviewAction} />
    )
  }
}
