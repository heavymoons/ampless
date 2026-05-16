'use client'

import { PostForm } from '../components/post-form.js'
import { useT } from '../components/i18n-provider.js'

function NewPostPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">{t('posts.form.newTitle')}</h1>
      <PostForm />
    </div>
  )
}

export function createNewPostPage(_admin: unknown) {
  return NewPostPage
}
