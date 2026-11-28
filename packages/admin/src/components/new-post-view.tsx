'use client'

import { PostForm, type EditorPostClass } from './post-form.js'
import { useT } from './i18n-provider.js'
import { TableClassesProvider, type EditorTableClass } from '../editor/table-classes-context.js'

interface NewPostPageProps {
  /**
   * Table custom classes declared by the active theme, resolved by
   * `createNewPostPage`. Offered by the editor's table controls.
   */
  tableClasses?: ReadonlyArray<EditorTableClass>
  /**
   * Post custom classes declared by the active theme, resolved by
   * `createNewPostPage`. Offered as the form's "Post classes" checkboxes.
   */
  postClasses?: ReadonlyArray<EditorPostClass>
  /**
   * Endpoint that `<PostForm>` POSTs the draft to for preview HTML.
   * Threaded down from `createNewPostPage`. Defaults to `/admin/preview`
   * inside `<PostForm>` when omitted.
   */
  previewEndpoint?: string
}

export function NewPostPage({ previewEndpoint, tableClasses, postClasses }: NewPostPageProps) {
  const t = useT()
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold md:mb-8 md:text-3xl">{t('posts.form.newTitle')}</h1>
      <TableClassesProvider classes={tableClasses}>
        <PostForm previewEndpoint={previewEndpoint} postClasses={postClasses} />
      </TableClassesProvider>
    </div>
  )
}
