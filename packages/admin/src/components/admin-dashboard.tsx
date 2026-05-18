'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listPosts, type Post } from 'ampless'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'

/**
 * Admin home / dashboard. Lists post counts. Marked client-side because
 * it reads from the AppSync client directly (no server-rendered query
 * yet — listed posts come from Amplify SDK at mount time).
 */
export function AdminDashboard() {
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
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-8">
        <h1 className="text-2xl font-bold md:text-3xl">{t('dashboard.title')}</h1>
        <Button asChild>
          <Link href="/admin/posts/new">{t('dashboard.newPost')}</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
