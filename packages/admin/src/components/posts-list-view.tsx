'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate, listPostSummaries, type PostSummary } from 'ampless'
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ampless/runtime/ui'
import {
  collectTags,
  filterSortPostSummaries,
  type PostListSort,
  type PostListStatusFilter,
} from '../lib/post-list-filter.js'
import { useT } from './i18n-provider.js'

const PAGE_SIZE = 100

export function PostsList() {
  const t = useT()
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<PostListStatusFilter>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [sort, setSort] = useState<PostListSort>('updated-desc')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    listPostSummaries({ status: 'all' })
      .then(setPosts)
      .catch((err: unknown) => {
        console.error('[posts-list-view] listPostSummaries failed:', err)
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, statusFilter, tagFilter, sort])

  const tagCounts = useMemo(() => collectTags(posts), [posts])
  const filteredPosts = useMemo(
    () =>
      filterSortPostSummaries(posts, {
        query,
        status: statusFilter,
        tag: tagFilter,
        sort,
      }),
    [posts, query, statusFilter, tagFilter, sort]
  )
  const visiblePosts = filteredPosts.slice(0, visibleCount)
  const hasMore = visibleCount < filteredPosts.length

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-8">
        <h1 className="text-2xl font-bold md:text-3xl">{t('posts.list.title')}</h1>
        <Button asChild>
          <Link href="/admin/posts/new">{t('posts.list.newButton')}</Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">
          {t('posts.list.loadError')}: {loadError}
        </p>
      ) : posts.length === 0 ? (
        <div className="rounded-md border p-12 text-center">
          <p className="text-muted-foreground">{t('posts.list.empty')}</p>
          <Button asChild className="mt-4">
            <Link href="/admin/posts/new">{t('posts.list.createFirst')}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-56 max-w-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('posts.list.searchPlaceholder')}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 py-1.5 text-sm"
              value={statusFilter}
              aria-label={t('common.status')}
              onChange={(e) => setStatusFilter(e.target.value as PostListStatusFilter)}
            >
              <option value="all">{t('posts.list.filterAll')}</option>
              <option value="published">{t('posts.list.filterPublished')}</option>
              <option value="draft">{t('posts.list.filterDraft')}</option>
            </select>
            <select
              className="h-9 rounded-md border bg-background px-2 py-1.5 text-sm"
              value={tagFilter}
              aria-label={t('common.tags')}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">{t('posts.list.filterAllTags')}</option>
              {[...tagCounts.entries()].map(([tag, count]) => (
                <option key={tag} value={tag}>
                  {tag} ({count})
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border bg-background px-2 py-1.5 text-sm"
              value={sort}
              aria-label={t('posts.list.sortLabel')}
              onChange={(e) => setSort(e.target.value as PostListSort)}
            >
              <option value="updated-desc">{t('posts.list.sortUpdatedDesc')}</option>
              <option value="updated-asc">{t('posts.list.sortUpdatedAsc')}</option>
              <option value="published-desc">{t('posts.list.sortPublishedDesc')}</option>
              <option value="published-asc">{t('posts.list.sortPublishedAsc')}</option>
              <option value="title-asc">{t('posts.list.sortTitleAsc')}</option>
              <option value="title-desc">{t('posts.list.sortTitleDesc')}</option>
            </select>
            <span className="text-sm text-muted-foreground">
              {t('posts.list.resultCount', {
                shown: filteredPosts.length,
                total: posts.length,
              })}
            </span>
          </div>

          {filteredPosts.length === 0 ? (
            <p className="rounded-md border p-8 text-center text-muted-foreground">
              {t('posts.list.noMatches')}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('posts.list.columnTitle')}</TableHead>
                      <TableHead>{t('posts.list.columnStatus')}</TableHead>
                      <TableHead>{t('posts.list.columnSlug')}</TableHead>
                      <TableHead>{t('posts.list.columnPublished')}</TableHead>
                      <TableHead>{t('posts.list.columnUpdated')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePosts.map((post) => (
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
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatPostDate(post.publishedAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatPostDate(post.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {hasMore && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                >
                  {t('posts.list.showMore')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatPostDate(value: string | undefined): string {
  return value ? formatDate(value) || '-' : '-'
}
