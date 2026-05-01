import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate } from 'ampless'
import { renderBody } from '@/lib/posts'
import { LightboxBinder } from '@/components/lightbox-content'
import { TagList } from '@/components/tag-list'
import { postMetadata } from '@/lib/seo'
import { loadSiteSettings } from '@/lib/site-settings'
import { getPublishedPost } from '@/lib/posts-public'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string; slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteId, slug } = await params
  const post = await getPublishedPost(slug, { siteId })
  if (!post) return {}
  return postMetadata(post, siteId)
}

export default async function PostPage({ params }: Props) {
  const { siteId, slug } = await params
  const [post, settings] = await Promise.all([
    getPublishedPost(slug, { siteId }),
    loadSiteSettings(siteId),
  ])
  if (!post) notFound()

  const defaultLightbox = settings.media.imageDisplay === 'lightbox'
  const maxWidth = settings.media.imageMaxWidth ?? '100%'
  const proseStyle: React.CSSProperties = {
    ['--ampless-img-max-width' as string]: maxWidth,
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="mb-8">
        <Link href="/" className="text-sm text-gray-500 hover:underline">← Back</Link>
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
  )
}
