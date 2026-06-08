import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { ampless } from '@/lib/ampless'
import { LightboxBinder } from '@/components/lightbox-content'
import { TagList } from '@/components/tag-list'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteSidebar } from '@/components/site-chrome/site-sidebar'
import { SiteFooter } from '@/components/site-chrome/site-footer'
import { CollapsibleSidebar } from '@/components/site-chrome/collapsible-sidebar'

type PostCtx = ThemeRouteContext<{ slug: string }>

export async function generatePostMetadata({ params }: PostCtx): Promise<Metadata> {
  const { slug } = await params
  const post = await ampless.getPublishedPost(slug)
  if (!post) return {}
  return ampless.postMetadata(post)
}

// Docs post page: sidebar always visible while reading. The sidebar
// re-uses theme.sidebarNav, so navigation context stays consistent
// across the home page and individual articles.
export default async function DocsPost({ params }: PostCtx) {
  const { slug } = await params
  const [post, settings, theme] = await Promise.all([
    ampless.getPublishedPost(slug),
    ampless.loadSiteSettings(),
    ampless.loadThemeConfig(),
  ])
  if (!post) notFound()

  const postBody = await ampless.publicBodyForPost(post)
  const html = await ampless.publicHtmlForPost(post)

  const defaultLightbox = settings.media.imageDisplay === 'lightbox'
  const maxWidth = settings.media.imageMaxWidth ?? '100%'
  const proseStyle: React.CSSProperties = {
    ['--ampless-img-max-width' as string]: maxWidth,
  }

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
          <SiteSidebar links={theme.values.sidebarNav} />
        </CollapsibleSidebar>

        <main className="min-w-0">
          <article>
            <header className="mb-8 border-b pb-6">
              <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
              {post.publishedAt && (
                <time
                  dateTime={post.publishedAt}
                  className="mt-2 block font-mono text-xs text-[var(--muted-foreground)]"
                >
                  {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                </time>
              )}
            </header>

            {postBody}

            {html.beforeContent}

            <div
              id="post-body"
              className="prose prose-neutral dark:prose-invert max-w-none [&_img]:max-w-[var(--ampless-img-max-width)] [&_img]:mx-auto"
              style={proseStyle}
            >
              {await ampless.renderBody(post)}
            </div>

            {html.afterContent}

            {await ampless.publicPostScriptsForPage([post])}

            <TagList tags={post.tags} className="mt-10 border-t pt-6" />
          </article>
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

      <LightboxBinder scopeSelector="#post-body" defaultLightbox={defaultLightbox} />
    </>
  )
}
