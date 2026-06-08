import type { Post } from 'ampless'
import { NewPostPage } from '../components/new-post-view.js'

/**
 * Options for `createNewPostPage`.
 *
 * `renderPreviewAction` is the Phase 7 hook — templates pass a
 * `'use server'` action that renders a draft post into a complete
 * HTML string (body + page-level scripts). The factory wraps the
 * client-side `NewPostPage` so the action threads down to
 * `<PostForm renderPreviewAction={...} />`. Without it the preview
 * pane shows a fallback message asking the engineer to wire the prop.
 */
export interface CreateNewPostPageOptions {
  renderPreviewAction?: (draft: Post) => Promise<string>
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
  const { renderPreviewAction } = opts
  return function NewPostPageWrapper() {
    return <NewPostPage renderPreviewAction={renderPreviewAction} />
  }
}
