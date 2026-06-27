'use client'

import { useEffect, useState, use } from 'react'
import { notFound } from 'next/navigation'
import { getPostById, type Post } from 'ampless'
import { PostForm } from './post-form.js'
import { useT } from './i18n-provider.js'

interface EditPostPageProps {
  params: Promise<{ postId: string }>
  /**
   * Endpoint that `<PostForm>` / `<PostHistoryPanel>` POST the draft to
   * for preview HTML. Threaded down from `createEditPostPage`. Defaults
   * to `/admin/preview` inside `<PostForm>` when omitted.
   */
  previewEndpoint?: string
}

export function EditPostPage({ params, previewEndpoint }: EditPostPageProps) {
  const t = useT()
  const { postId } = use(params)
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    getPostById(postId)
      .then((p) => {
        if (!p) setMissing(true)
        else setPost(p)
      })
      .catch((err) => {
        // A fetch failure is distinct from "not found": surface it instead
        // of leaving an unhandled rejection (getPostById throws on AppSync
        // errors) that would strand the page on the loading state.
        console.error('[ampless admin] failed to load post for editing:', err)
        setError(true)
      })
      .finally(() => setLoading(false))
  }, [postId])

  if (loading)
    return <div className="mx-auto max-w-7xl p-4 md:p-8">{t('common.loading')}</div>
  if (error)
    return <div className="mx-auto max-w-7xl p-4 md:p-8">{t('common.loadError')}</div>
  if (missing) notFound()

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold md:mb-8 md:text-3xl">{t('posts.form.editTitle')}</h1>
      {post && <PostForm post={post} previewEndpoint={previewEndpoint} />}
    </div>
  )
}
