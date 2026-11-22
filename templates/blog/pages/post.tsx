import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, parseLinkList, type ThemeRouteContext } from 'ampless'
import { ampless } from '@/lib/ampless'
import { admin } from '@/lib/admin'
import { LightboxBinder } from '@/components/lightbox-content'
import { TagList } from '@/components/tag-list'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'

type PostCtx = ThemeRouteContext<{ slug: string }>

function buildPostUrl(siteUrl: string, slug: string) {
  return new URL(`/${slug}`, siteUrl).toString()
}

function buildXShareUrl(articleUrl: string, title: string, excerpt?: string | null) {
  const text = [`"${title}"`, excerpt].filter(Boolean).join('\n\n')
  const params = new URLSearchParams({ url: articleUrl, text })
  return `https://x.com/intent/tweet?${params.toString()}`
}

export async function generatePostMetadata({ params }: PostCtx): Promise<Metadata> {
  const { slug } = await params
  const post = await ampless.getPublishedPost(slug)
  if (!post) return {}
  return ampless.postMetadata(post)
}

export default async function BlogPost({ params }: PostCtx) {
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
  const showHeader =
    parseLinkList(theme.values.headerNav).length > 0 || !!theme.values.logoUrl?.trim()
  const showFooter = parseLinkList(theme.values.footerLinks).length > 0
  const articleUrl = buildPostUrl(settings.site.url, post.slug)
  const xShareUrl = buildXShareUrl(articleUrl, post.title, post.excerpt)

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
          <Link href="/" className="text-sm text-gray-500 hover:underline">{admin.t('public.back')}</Link>
        </nav>

        <article>
          <header className="mb-8 border-b pb-6">
            <h1 className="text-4xl font-bold tracking-tight">{post.title}</h1>
            {post.publishedAt && (
              <time dateTime={post.publishedAt} className="mt-2 block text-sm text-gray-500">
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

          <footer className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <a href={articleUrl} className="hover:text-foreground hover:underline">{admin.t('public.permalink')}</a>
            <a href={xShareUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M13.8 10.4 21 2h-1.7l-6.2 7.3L8.1 2H2.3l7.6 11.1L2.3 22h1.7l6.7-7.8 5.4 7.8h5.8l-8.1-11.6Zm-2.4 2.8-.8-1.1L4.5 3.3h2.8l4.9 7.1.8 1.1 6.4 9.2h-2.8l-5.2-7.5Z" />
              </svg>
              {admin.t('public.shareOnX')}
            </a>
          </footer>
        </article>

        <LightboxBinder scopeSelector="#post-body" defaultLightbox={defaultLightbox} />
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
