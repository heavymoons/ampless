'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listPosts, type Post } from 'ampless'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useT } from '@/components/i18n-provider'

export default function AdminDashboard() {
  const t = useT()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listPosts({ status: 'all' })
      .then(setPosts)
      .finally(() => setLoading(false))
  }, [])

  const published = posts.filter((p) => p.status === 'published').length
  const drafts = posts.filter((p) => p.status === 'draft').length

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
        <Button asChild>
          <Link href="/admin/posts/new">{t('dashboard.newPost')}</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.totalPosts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{loading ? '—' : posts.length}</p>
            <p className="text-sm text-muted-foreground">{t('dashboard.totalLabel')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.published')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{loading ? '—' : published}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.drafts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{loading ? '—' : drafts}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
