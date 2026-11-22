import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { ampless } from '@/lib/ampless'
import { admin } from '@/lib/admin'
import { LightboxBinder } from '@/components/lightbox-content'
import { TagList } from '@/components/tag-list'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

type PostCtx = ThemeRouteContext<{ slug: string }>

export async function generatePostMetadata({ params }: PostCtx): Promise<Metadata> {
  const { slug } = await params
  const post = await ampless.getPublishedPost(slug)
  if (!post) return {}
  return ampless.postMetadata(post)
}

export default async function CorporatePost({ params }: PostCtx) {
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
  const footerLegend = theme.values.footerLegend?.trim()

  return (
    <>
      <SiteHeader
        links={theme.values.headerNav}
        logoUrl={theme.values.logoUrl}
        siteName={settings.site.name}
        brandClassName="text-lg font-semibold tracking-tight"
      />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <nav className="mb-6">
          <Link href="/" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)]">
            {admin.t('public.back')}
          </Link>
        </nav>

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

          <TagList tags={post.tags} className="mt-8 border-t pt-6" />
        </article>

        <LightboxBinder scopeSelector="#post-body" defaultLightbox={defaultLightbox} />
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
