'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listPosts, type Post } from 'ampless'
import { readAdminSiteIdFromCookie } from '@/lib/admin-site-client'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/components/i18n-provider'

export default function PostsList() {
  const t = useT()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const siteId = readAdminSiteIdFromCookie()
    listPosts({ status: 'all', siteId })
      .then(setPosts)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('posts.list.title')}</h1>
        <Button asChild>
          <Link href="/admin/posts/new">{t('posts.list.newButton')}</Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : posts.length === 0 ? (
        <div className="rounded-md border p-12 text-center">
          <p className="text-muted-foreground">{t('posts.list.empty')}</p>
          <Button asChild className="mt-4">
            <Link href="/admin/posts/new">{t('posts.list.createFirst')}</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('posts.list.columnTitle')}</TableHead>
                <TableHead>{t('posts.list.columnStatus')}</TableHead>
                <TableHead>{t('posts.list.columnSlug')}</TableHead>
                <TableHead>{t('posts.list.columnUpdated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.postId}>
                  <TableCell>
                    <Link
                      href={`/admin/posts/${post.postId}`}
                      className="font-medium hover:underline"
                    >
                      {post.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        post.status === 'published'
                          ? 'inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                          : 'inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700'
                      }
                    >
                      {t(`common.${post.status}`)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {post.slug}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
