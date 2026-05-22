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
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) return {}
  return postMetadata(post)
}

export default async function DadsPost({ params }: PostCtx) {
  const { slug } = await params
  const [post, settings, theme] = await Promise.all([
    getPublishedPost(slug),
    loadSiteSettings(),
    loadThemeConfig(),
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
        brandClassName="text-base font-bold tracking-tight"
        className="border-b-2 border-[var(--primary)]"
      />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <nav className="mb-8 text-sm">
          <Link
            href="/"
            className="text-[var(--primary)] underline-offset-4 hover:underline"
          >
            {t('public.back')}
          </Link>
        </nav>

        <article>
          <header className="mb-10 border-b pb-6">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {post.title}
            </h1>
            {post.publishedAt && (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                <time dateTime={post.publishedAt}>
                  {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                </time>
              </p>
            )}
          </header>

          <div
            id="post-body"
            className="prose prose-neutral dark:prose-invert max-w-none [&_a]:text-[var(--primary)] [&_a]:underline-offset-4 [&_img]:max-w-[var(--ampless-img-max-width)] [&_img]:mx-auto"
            style={proseStyle}
            dangerouslySetInnerHTML={{ __html: renderBody(post) }}
          />

          <TagList tags={post.tags} className="mt-10 border-t pt-6" />
        </article>

        <LightboxBinder scopeSelector="#post-body" defaultLightbox={defaultLightbox} />
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
