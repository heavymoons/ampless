import Link from 'next/link'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { ampless } from '@/lib/ampless'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

// Hero-led landing layout: big headline + subhead + CTA, then an
// optional "Latest" grid sourced from published posts. Falls back to
// site name / description when the manifest hero fields are empty.
export default async function LandingHome(_: ThemeRouteContext) {
  const [settings, theme, postsResult] = await Promise.all([
    ampless.loadSiteSettings(),
    ampless.loadThemeConfig(),
    ampless.listPublishedPosts({ limit: 6 }),
  ])

  // Featured embed below the hero — typical use is a short "About"
  // or "Welcome" article. Filtered out of the Latest grid below to
  // avoid showing the same post twice.
  const featuredSlug = theme.values.featuredSlug?.trim()
  const featured = featuredSlug ? await ampless.getPublishedPost(featuredSlug) : null
  const posts = featured
    ? postsResult.items.filter((p) => p.slug !== featured.slug)
    : postsResult.items

  const headline = theme.values.heroHeadline?.trim() || settings.site.name
  const subheadline =
    theme.values.heroSubheadline?.trim() || settings.site.description || ''
  const ctaText = theme.values.ctaText?.trim() || ''
  const ctaUrl = theme.values.ctaUrl?.trim() || '#'

  return (
    <>
      <SiteHeader
        links={theme.values.headerNav}
        logoUrl={theme.values.logoUrl}
        siteName={settings.site.name}
        brandClassName="font-semibold hover:text-[var(--primary)]"
      />

      <main>
        <section className="bg-gradient-to-b from-[var(--accent)] to-[var(--background)] px-6 py-24 text-center">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{headline}</h1>
            {subheadline && (
              <p className="mt-6 text-xl text-[var(--muted-foreground)]">{subheadline}</p>
            )}
            {ctaText && (
              <div className="mt-10">
                <Link
                  href={ctaUrl}
                  className="inline-block rounded-[var(--radius)] bg-[var(--primary)] px-8 py-3 text-lg font-medium text-[var(--primary-foreground)] transition hover:opacity-90"
                >
                  {ctaText}
                </Link>
              </div>
            )}
          </div>
        </section>

        {featured && (
          <section className="mx-auto max-w-3xl px-6 py-16">
            <article>
              <h2 className="text-3xl font-bold tracking-tight">{featured.title}</h2>
              <div className="prose prose-neutral dark:prose-invert mt-6 max-w-none">
                {await ampless.renderBody(featured)}
              </div>
            </article>
          </section>
        )}

        {featured && (await ampless.publicPostScriptsForPage([featured]))}

        {posts.length > 0 && (
          <section className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="mb-8 text-3xl font-bold">Latest</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <article
                  key={post.postId}
                  className="rounded-[var(--radius)] border bg-[var(--card)] p-6 transition hover:shadow-lg"
                >
                  <Link href={`/${post.slug}`} className="block">
                    <h3 className="text-lg font-semibold leading-tight hover:underline">
                      {post.title}
                    </h3>
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
          </section>
        )}
      </main>

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
