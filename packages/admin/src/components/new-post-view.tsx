'use client'

import { PostForm } from './post-form.js'
import { useT } from './i18n-provider.js'

export function NewPostPage() {
  const t = useT()
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold md:mb-8 md:text-3xl">{t('posts.form.newTitle')}</h1>
      <PostForm />
    </div>
  )
}
