import Link from 'next/link'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { ampless } from '@/lib/ampless'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

// DADS home: hero band with strong title bar, optional featured post,
// formal news list with prominent dates. Layout deliberately
// understated — DADS leans on hierarchy and whitespace, not
// decoration.
export default async function DadsHome(_: ThemeRouteContext) {
  const [settings, theme, postsResult] = await Promise.all([
    ampless.loadSiteSettings(),
    ampless.loadThemeConfig(),
    ampless.listPublishedPosts({ limit: 10 }),
  ])

  const featuredSlug = theme.values.featuredSlug?.trim()
  const featured = featuredSlug ? await ampless.getPublishedPost(featuredSlug) : null
  const posts = featured
    ? postsResult.items.filter((p) => p.slug !== featured.slug)
    : postsResult.items

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

      <main>
        <section className="border-b bg-[var(--secondary)] px-6 py-12">
          <div className="mx-auto max-w-4xl">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {settings.site.name}
            </h1>
            {settings.site.description && (
              <p className="mt-3 max-w-2xl leading-relaxed">{settings.site.description}</p>
            )}
          </div>
        </section>

        {featured && (
          <section className="border-b px-6 py-12">
            <div className="mx-auto max-w-4xl">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--primary)]">
                {featured.publishedAt ? (
                  <time dateTime={featured.publishedAt}>
                    {formatDate(featured.publishedAt, settings.dateFormat, settings.timezone)}
                  </time>
                ) : (
                  '—'
                )}
              </p>
              <h2 className="text-2xl font-bold tracking-tight">
                <Link href={`/${featured.slug}`} className="underline-offset-4 hover:underline">
                  {featured.title}
                </Link>
              </h2>
              <div className="prose prose-neutral dark:prose-invert mt-6 max-w-none">
                {await ampless.renderBody(featured)}
              </div>
            </div>
          </section>
        )}

        {featured && (await ampless.publicPostScriptsForPage([featured]))}

        {posts.length > 0 && (
          <section className="px-6 py-12">
            <div className="mx-auto max-w-4xl">
              <h2 className="mb-6 border-b-2 border-[var(--primary)] pb-2 text-lg font-bold">
                お知らせ / News
              </h2>
              <ul className="divide-y">
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
            </div>
          </section>
        )}
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
