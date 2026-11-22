'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listPostSummaries, type PostSummary } from 'ampless'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'
import { getPostDisplayStatus, nextScheduledTransition } from '../lib/post-display-status.js'
import { useNow } from '../lib/use-now.js'

/**
 * Admin home / dashboard. Lists post counts. Marked client-side because
 * it reads from the AppSync client directly (no server-rendered query
 * yet — listed posts come from Amplify SDK at mount time).
 */
export function AdminDashboard() {
  const t = useT()
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    listPostSummaries({ status: 'all' })
      .then(setPosts)
      .catch((err: unknown) => {
        console.error('[admin-dashboard] listPostSummaries failed:', err)
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [])

  // Scheduled posts (published with a future publishedAt) are counted
  // separately; `now` advances when the earliest one goes live.
  const now = useNow((current) => nextScheduledTransition(posts, current))
  const published = posts.filter((p) => getPostDisplayStatus(p, now) === 'published').length
  const scheduled = posts.filter((p) => getPostDisplayStatus(p, now) === 'scheduled').length
  const drafts = posts.filter((p) => p.status === 'draft').length
  const countPending = loading || Boolean(loadError)

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-8">
        <h1 className="text-2xl font-bold md:text-3xl">{t('dashboard.title')}</h1>
        <Button asChild>
          <Link href="/admin/posts/new">{t('dashboard.newPost')}</Link>
        </Button>
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-destructive">
          {t('posts.list.loadError')}: {loadError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.totalPosts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{countPending ? '-' : posts.length}</p>
            <p className="text-sm text-muted-foreground">{t('dashboard.totalLabel')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.published')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{countPending ? '-' : published}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.scheduled')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{countPending ? '-' : scheduled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.drafts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{countPending ? '-' : drafts}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
