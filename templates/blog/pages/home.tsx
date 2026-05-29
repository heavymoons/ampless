import Link from 'next/link'
import { formatDate, parseLinkList, type ThemeRouteContext } from 'ampless'
import { renderBody } from '@ampless/runtime'
import { ampless } from '@/lib/ampless'
import { admin } from '@/lib/admin'
import { TagList } from '@/components/tag-list'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

export default async function BlogHome(_: ThemeRouteContext) {
  const [settings, theme, postsResult] = await Promise.all([
    ampless.loadSiteSettings(),
    ampless.loadThemeConfig(),
    ampless.listPublishedPosts(),
  ])

  // Featured (pinned) post: render the body inline above the list,
  // then drop the same slug from the feed so it doesn't show twice.
  // Missing / unpublished slugs return null and the section is skipped.
  const featuredSlug = theme.values.featuredSlug?.trim()
  const featured = featuredSlug ? await ampless.getPublishedPost(featuredSlug) : null
  const posts = featured
    ? postsResult.items.filter((p) => p.slug !== featured.slug)
    : postsResult.items

  const showHeader =
    parseLinkList(theme.values.headerNav).length > 0 || !!theme.values.logoUrl?.trim()
  const showFooter = parseLinkList(theme.values.footerLinks).length > 0

  return (
    <>
      {showHeader && (
        <SiteHeader
          links={theme.values.headerNav}
          logoUrl={theme.values.logoUrl}
          siteName={settings.site.name}
          brandClassName="font-semibold hover:underline"
        />
      )}

      <main className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-12 border-b pb-6">
          <h1 className="text-4xl font-bold tracking-tight">{settings.site.name}</h1>
          {settings.site.description && (
            <p className="mt-2 text-gray-600">{settings.site.description}</p>
          )}
        </header>

        {featured && (
          <article className="mb-12 rounded-lg border bg-[var(--card)] p-6">
            <Link href={`/${featured.slug}`} className="group">
              <h2 className="text-2xl font-semibold group-hover:underline">{featured.title}</h2>
              {featured.publishedAt && (
                <time
                  dateTime={featured.publishedAt}
                  className="mt-1 block text-sm text-gray-500"
                >
                  {formatDate(featured.publishedAt, settings.dateFormat, settings.timezone)}
                </time>
              )}
            </Link>
            <div
              className="prose prose-neutral dark:prose-invert mt-4 max-w-none"
              dangerouslySetInnerHTML={{ __html: renderBody(featured) }}
            />
          </article>
        )}

        {posts.length === 0 ? (
          !featured && <p className="text-gray-500">{admin.t('public.noPosts')}</p>
        ) : (
          <ul className="space-y-8">
            {posts.map((post) => (
              <li key={post.postId}>
                <Link href={`/${post.slug}`} className="block group">
                  <h2 className="text-2xl font-semibold group-hover:underline">{post.title}</h2>
                  {post.publishedAt && (
                    <time dateTime={post.publishedAt} className="text-sm text-gray-500">
                      {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                    </time>
                  )}
                  {post.excerpt && <p className="mt-2 text-gray-700">{post.excerpt}</p>}
                </Link>
                <TagList tags={post.tags} className="mt-3" max={3} />
              </li>
            ))}
          </ul>
        )}
      </main>

      {showFooter && (
        <SiteFooter
          links={theme.values.footerLinks}
          legend={
            <span>
              © {new Date().getFullYear()} {settings.site.name}
            </span>
          }
        />
      )}
    </>
  )
}
