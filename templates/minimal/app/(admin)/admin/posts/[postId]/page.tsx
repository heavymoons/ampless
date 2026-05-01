'use client'

import { useEffect, useState, use } from 'react'
import { notFound } from 'next/navigation'
import { getPostById, type Post } from 'ampless'
import { readAdminSiteIdFromCookie } from '@/lib/admin-site-client'
import { PostForm } from '@/components/admin/post-form'

export default function EditPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = use(params)
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const siteId = readAdminSiteIdFromCookie()
    getPostById(postId, { siteId })
      .then((p) => {
        if (!p) setMissing(true)
        else setPost(p)
      })
      .finally(() => setLoading(false))
  }, [postId])

  if (loading) return <div className="p-8">Loading...</div>
  if (missing) notFound()

  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">Edit post</h1>
      {post && <PostForm post={post} />}
    </div>
  )
}
