import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { listPostsByTag } from '@/lib/posts-public'
import { loadSiteSettings } from '@/lib/site-settings'
import { loadThemeConfig } from '@/lib/theme-config'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'
import { t } from '@/lib/i18n'

export default async function DadsTag({ params }: ThemeRouteContext<{ tag: string }>) {
  const { tag } = await params
  const decodedTag = decodeURIComponent(tag)
  const [{ items: posts }, settings, theme] = await Promise.all([
    listPostsByTag(decodedTag, { limit: 50 }),
    loadSiteSettings(),
    loadThemeConfig(),
  ])
  if (posts.length === 0) notFound()

  const footerLegend = theme.values.footerLegend?.trim()

  return (
    <>
      <SiteHeader
        links={theme.values.headerNav}
        logoUrl={theme.values.logoUrl}
        siteName={settings.site.name}
        brandClassName="text-base font-bold tracking-tight"
        className="border-b-2 border-[var(--primary)]"
      />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <nav className="mb-8 text-sm">
          <Link
            href="/"
            className="text-[var(--primary)] underline-offset-4 hover:underline"
          >
            {t('public.home')}
          </Link>
        </nav>

        <header className="mb-10">
          <p className="text-sm text-[var(--muted-foreground)]">{t('public.tagLabel')}</p>
          <h1 className="text-3xl font-bold tracking-tight">#{decodedTag}</h1>
        </header>

        <ul className="divide-y border-y">
          {posts.map((post) => (
            <li key={post.postId} className="py-4">
              <Link
                href={`/${post.slug}`}
                className="group flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
              >
                {post.publishedAt && (
                  <time
                    dateTime={post.publishedAt}
                    className="font-mono text-xs tracking-wide text-[var(--muted-foreground)] sm:w-32 sm:shrink-0"
                  >
                    {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                  </time>
                )}
                <span className="flex-1 underline-offset-4 group-hover:underline">
                  {post.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <SiteFooter
        links={theme.values.footerLinks}
        className="bg-[var(--secondary)]"
        legend={
          <div className="space-y-1">
            {footerLegend && <p className="whitespace-pre-line">{footerLegend}</p>}
            <p>
              © {new Date().getFullYear()} {settings.site.name}
            </p>
          </div>
        }
      />
    </>
  )
}
