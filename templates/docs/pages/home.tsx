import Link from 'next/link'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { listPublishedPosts } from '@/lib/posts-public'
import { loadSiteSettings } from '@/lib/site-settings'
import { loadThemeConfig } from '@/lib/theme-config'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteSidebar } from '@/components/site-chrome/site-sidebar'
import { SiteFooter } from '@/components/site-chrome/site-footer'
import { CollapsibleSidebar } from '@/components/site-chrome/collapsible-sidebar'

// Docs home: sidebar nav on the left (with optional tag-driven
// sections), latest posts list on the right. Acts as the docs landing
// page until the user arranges static pages.
export default async function DocsHome({ params }: ThemeRouteContext) {
  const { siteId } = await params
  const [settings, theme, postsResult] = await Promise.all([
    loadSiteSettings(siteId),
    loadThemeConfig(siteId),
    listPublishedPosts({ siteId, limit: 12 }),
  ])
  const posts = postsResult.items

  return (
    <>
      <SiteHeader
        links={theme.values.headerNav}
        logoUrl={theme.values.logoUrl}
        siteName={settings.site.name}
        brandClassName="font-mono text-sm font-semibold tracking-tight"
      />

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-10 lg:grid-cols-[15rem_1fr] lg:gap-10">
        <CollapsibleSidebar className="lg:sticky lg:top-6 lg:self-start">
          <SiteSidebar links={theme.values.sidebarNav} siteId={siteId} />
        </CollapsibleSidebar>

        <main className="min-w-0">
          <header className="mb-10">
            <h1 className="text-3xl font-bold tracking-tight">{settings.site.name}</h1>
            {settings.site.description && (
              <p className="mt-2 text-[var(--muted-foreground)]">{settings.site.description}</p>
            )}
          </header>

          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Recently updated
          </h2>
          {posts.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No posts published yet.</p>
          ) : (
            <ul className="space-y-3">
              {posts.map((post) => (
                <li key={post.postId}>
                  <Link
                    href={`/${post.slug}`}
                    className="block rounded-[var(--radius)] border bg-[var(--card)] p-4 transition hover:border-[var(--primary)]"
                  >
                    <div className="font-medium">{post.title}</div>
                    {post.publishedAt && (
                      <time
                        dateTime={post.publishedAt}
                        className="mt-1 block font-mono text-xs text-[var(--muted-foreground)]"
                      >
                        {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                      </time>
                    )}
                    {post.excerpt && (
                      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{post.excerpt}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      <SiteFooter
        links={theme.values.footerLinks}
        legend={
          <span>
            © {new Date().getFullYear()} {settings.site.name}
          </span>
        }
      />
    </>
  )
}
