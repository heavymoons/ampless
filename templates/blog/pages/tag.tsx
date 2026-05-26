import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, parseLinkList, type ThemeRouteContext } from 'ampless'
import { ampless } from '@/lib/ampless'
import { admin } from '@/lib/admin'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

export default async function BlogTag({ params }: ThemeRouteContext<{ tag: string }>) {
  const { tag } = await params
  const decodedTag = decodeURIComponent(tag)
  const [{ items: posts }, settings, theme] = await Promise.all([
    ampless.listPostsByTag(decodedTag, { limit: 50 }),
    ampless.loadSiteSettings(),
    ampless.loadThemeConfig(),
  ])

  if (posts.length === 0) notFound()

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
        <nav className="mb-8">
          <Link href="/" className="text-sm text-gray-500 hover:underline">{admin.t('public.home')}</Link>
        </nav>

        <header className="mb-12 border-b pb-6">
          <p className="text-sm text-gray-500">{admin.t('public.tagLabel')}</p>
          <h1 className="text-4xl font-bold tracking-tight">#{decodedTag}</h1>
        </header>

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
            </li>
          ))}
        </ul>
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
