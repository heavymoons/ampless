import Link from 'next/link'
import { formatDate, parseLinkList, type ThemeRouteContext } from 'ampless'
import { listPublishedPosts } from '@/lib/posts-public'
import { loadSiteSettings } from '@/lib/site-settings'
import { loadThemeConfig } from '@/lib/theme-config'
import { TagList } from '@/components/tag-list'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'
import { t } from '@/lib/i18n'

export default async function BlogHome({ params }: ThemeRouteContext) {
  const { siteId } = await params
  const [settings, theme, postsResult] = await Promise.all([
    loadSiteSettings(siteId),
    loadThemeConfig(siteId),
    listPublishedPosts({ siteId }),
  ])
  const posts = postsResult.items
  const showHeader = parseLinkList(theme.values.headerNav).length > 0
  const showFooter = parseLinkList(theme.values.footerLinks).length > 0

  return (
    <>
      {showHeader && (
        <SiteHeader
          links={theme.values.headerNav}
          brand={
            <Link href="/" className="hover:underline">
              {settings.site.name}
            </Link>
          }
        />
      )}

      <main className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-12 border-b pb-6">
          <h1 className="text-4xl font-bold tracking-tight">{settings.site.name}</h1>
          {settings.site.description && (
            <p className="mt-2 text-gray-600">{settings.site.description}</p>
          )}
        </header>

        {posts.length === 0 ? (
          <p className="text-gray-500">{t('public.noPosts')}</p>
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
                <TagList tags={post.tags} className="mt-3" />
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
