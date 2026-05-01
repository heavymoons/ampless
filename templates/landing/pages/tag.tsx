import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { listPostsByTag } from '@/lib/posts-public'
import { loadSiteSettings } from '@/lib/site-settings'
import { t } from '@/lib/i18n'

export default async function LandingTag({ params }: ThemeRouteContext<{ tag: string }>) {
  const { siteId, tag } = await params
  const decodedTag = decodeURIComponent(tag)
  const [{ items: posts }, settings] = await Promise.all([
    listPostsByTag(decodedTag, { siteId, limit: 50 }),
    loadSiteSettings(siteId),
  ])

  if (posts.length === 0) notFound()

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <nav className="mb-10">
        <Link
          href="/"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)]"
        >
          {t('public.home')}
        </Link>
      </nav>

      <header className="mb-12">
        <p className="text-sm text-[var(--muted-foreground)]">{t('public.tagLabel')}</p>
        <h1 className="text-4xl font-bold tracking-tight">#{decodedTag}</h1>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <article
            key={post.postId}
            className="rounded-[var(--radius)] border bg-[var(--card)] p-6 transition hover:shadow-lg"
          >
            <Link href={`/${post.slug}`} className="block">
              <h2 className="text-lg font-semibold leading-tight hover:underline">{post.title}</h2>
              {post.publishedAt && (
                <time
                  dateTime={post.publishedAt}
                  className="mt-2 block text-xs text-[var(--muted-foreground)]"
                >
                  {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                </time>
              )}
              {post.excerpt && (
                <p className="mt-3 text-sm text-[var(--muted-foreground)] line-clamp-3">
                  {post.excerpt}
                </p>
              )}
            </Link>
          </article>
        ))}
      </div>
    </main>
  )
}
