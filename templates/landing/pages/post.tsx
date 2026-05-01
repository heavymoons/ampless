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

export default async function LandingPost({ params }: PostCtx) {
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

  return (
    <>
      <SiteHeader
        links={theme.values.headerNav}
        logoUrl={theme.values.logoUrl}
        siteName={settings.site.name}
        brandClassName="font-semibold hover:text-[var(--primary)]"
      />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <nav className="mb-10">
          <Link
            href="/"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)]"
          >
            {t('public.back')}
          </Link>
        </nav>

        <article>
          <header className="mb-10">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{post.title}</h1>
            {post.publishedAt && (
              <time
                dateTime={post.publishedAt}
                className="mt-3 block text-sm text-[var(--muted-foreground)]"
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

          <TagList tags={post.tags} className="mt-10 border-t pt-6" />
        </article>

        <LightboxBinder scopeSelector="#post-body" defaultLightbox={defaultLightbox} />
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
