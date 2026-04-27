import Link from 'next/link'
import { notFound } from 'next/navigation'
import { renderBody } from '@/lib/posts'
import { LightboxBinder } from '@/components/lightbox-content'
import cmsConfig from '@/cms.config'
import { getPublishedPost } from '@/lib/posts-public'

export const dynamic = 'force-dynamic'

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) notFound()

  const defaultLightbox = cmsConfig.media?.imageDisplay === 'lightbox'
  const maxWidth = cmsConfig.media?.imageMaxWidth ?? '100%'
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
            <time className="mt-2 block text-sm text-gray-500">
              {new Date(post.publishedAt).toLocaleDateString()}
            </time>
          )}
        </header>

        <div
          id="post-body"
          className="prose prose-neutral max-w-none [&_img]:max-w-[var(--ampless-img-max-width)] [&_img]:mx-auto"
          style={proseStyle}
          dangerouslySetInnerHTML={{ __html: renderBody(post) }}
        />
      </article>

      <LightboxBinder scopeSelector="#post-body" defaultLightbox={defaultLightbox} />
    </main>
  )
}
