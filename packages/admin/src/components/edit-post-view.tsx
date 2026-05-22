'use client'

import { useEffect, useState, use } from 'react'
import { notFound } from 'next/navigation'
import { getPostById, type Post } from 'ampless'
import { PostForm } from './post-form.js'
import { useT } from './i18n-provider.js'

export function EditPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const t = useT()
  const { postId } = use(params)
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    getPostById(postId)
      .then((p) => {
        if (!p) setMissing(true)
        else setPost(p)
      })
      .finally(() => setLoading(false))
  }, [postId])

  if (loading)
    return <div className="mx-auto max-w-7xl p-4 md:p-8">{t('common.loading')}</div>
  if (missing) notFound()

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold md:mb-8 md:text-3xl">{t('posts.form.editTitle')}</h1>
      {post && <PostForm post={post} />}
    </div>
  )
}
