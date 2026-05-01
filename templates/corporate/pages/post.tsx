import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { renderBody } from '@/lib/posts'
import { LightboxBinder } from '@/components/lightbox-content'
import { TagList } from '@/components/tag-list'
import { postMetadata } from '@/lib/seo'
import { loadSiteSettings } from '@/lib/site-settings'
import { loadThemeConfig } from '@/lib/theme-config'
import { getPublishedPost } from '@/lib/posts-public'
import { SiteHeader } from '@/components/site-chrome/site-header'
import { SiteFooter } from '@/components/site-chrome/site-footer'
import { t } from '@/lib/i18n'

type PostCtx = ThemeRouteContext<{ slug: string }>

export async function generatePostMetadata({ params }: PostCtx): Promise<Metadata> {
  const { siteId, slug } = await params
  const post = await getPublishedPost(slug, { siteId })
  if (!post) return {}
  return postMetadata(post, siteId)
}

export default async function CorporatePost({ params }: PostCtx) {
  const { siteId, slug } = await params
  const [post, settings, theme] = await Promise.all([
    getPublishedPost(slug, { siteId }),
    loadSiteSettings(siteId),
    loadThemeConfig(siteId),
  ])
  if (!post) notFound()

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
            {t('public.back')}
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

          <div
            id="post-body"
            className="prose prose-neutral dark:prose-invert max-w-none [&_img]:max-w-[var(--ampless-img-max-width)] [&_img]:mx-auto"
            style={proseStyle}
            dangerouslySetInnerHTML={{ __html: renderBody(post) }}
          />

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
