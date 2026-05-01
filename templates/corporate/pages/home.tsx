import Link from 'next/link'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { listPublishedPosts } from '@/lib/posts-public'
import { loadSiteSettings } from '@/lib/site-settings'
import { loadThemeConfig } from '@/lib/theme-config'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

export default async function CorporateHome({ params }: ThemeRouteContext) {
  const { siteId } = await params
  const [settings, theme, postsResult] = await Promise.all([
    loadSiteSettings(siteId),
    loadThemeConfig(siteId),
    listPublishedPosts({ siteId, limit: 8 }),
  ])
  const posts = postsResult.items
  const tagline = theme.values.tagline?.trim()
  const footerLegend = theme.values.footerLegend?.trim()

  return (
    <>
      <SiteHeader
        links={theme.values.headerNav}
        logoUrl={theme.values.logoUrl}
        siteName={settings.site.name}
        brandClassName="text-lg font-semibold tracking-tight"
      />

      <main>
        <section className="border-b bg-[var(--secondary)] px-6 py-16">
          <div className="mx-auto max-w-4xl">
            {tagline && (
              <p className="text-sm font-medium uppercase tracking-wider text-[var(--primary)]">
                {tagline}
              </p>
            )}
            <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
              {settings.site.name}
            </h1>
            {settings.site.description && (
              <p className="mt-4 max-w-2xl text-lg text-[var(--muted-foreground)]">
                {settings.site.description}
              </p>
            )}
          </div>
        </section>

        {posts.length > 0 && (
          <section className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="mb-8 border-l-4 border-[var(--primary)] pl-4 text-2xl font-bold">
              News
            </h2>
            <ul className="divide-y border-t border-b">
              {posts.map((post) => (
                <li key={post.postId} className="py-5">
                  <Link href={`/${post.slug}`} className="group flex items-baseline gap-6">
                    {post.publishedAt && (
                      <time
                        dateTime={post.publishedAt}
                        className="w-28 shrink-0 font-mono text-xs text-[var(--muted-foreground)]"
                      >
                        {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                      </time>
                    )}
                    <span className="flex-1 text-base font-medium group-hover:text-[var(--primary)]">
                      {post.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter
        links={theme.values.footerLinks}
        legend={
          <div className="space-y-1">
            {footerLegend && <p>{footerLegend}</p>}
            <p>
              © {new Date().getFullYear()} {settings.site.name}
            </p>
          </div>
        }
      />
    </>
  )
}
