'use client'

import { PostForm } from '@/components/admin/post-form'
import { useT } from '@/components/i18n-provider'

export default function NewPostPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">{t('posts.form.newTitle')}</h1>
      <PostForm />
    </div>
  )
}
