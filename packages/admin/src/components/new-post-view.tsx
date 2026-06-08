'use client'

import type { Post } from 'ampless'
import { PostForm } from './post-form.js'
import { useT } from './i18n-provider.js'

interface NewPostPageProps {
  /**
   * Phase 7: server action threaded from `createNewPostPage` factory
   * down into `<PostForm>` for iframe-based preview rendering.
   */
  renderPreviewAction?: (draft: Post) => Promise<string>
}

export function NewPostPage({ renderPreviewAction }: NewPostPageProps) {
  const t = useT()
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold md:mb-8 md:text-3xl">{t('posts.form.newTitle')}</h1>
      <PostForm renderPreviewAction={renderPreviewAction} />
    </div>
  )
}
