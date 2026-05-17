'use client'

import { PostForm } from './post-form.js'
import { useT } from './i18n-provider.js'

export function NewPostPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">{t('posts.form.newTitle')}</h1>
      <PostForm />
    </div>
  )
}
