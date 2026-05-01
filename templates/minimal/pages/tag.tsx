import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, type ThemeRouteContext } from 'ampless'
import { listPostsByTag } from '@/lib/posts-public'
import { loadSiteSettings } from '@/lib/site-settings'

export default async function MinimalTag({ params }: ThemeRouteContext<{ tag: string }>) {
  const { siteId, tag } = await params
  const decodedTag = decodeURIComponent(tag)
  const [{ items: posts }, settings] = await Promise.all([
    listPostsByTag(decodedTag, { siteId, limit: 50 }),
    loadSiteSettings(siteId),
  ])

  if (posts.length === 0) notFound()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="mb-8">
        <Link href="/" className="text-sm text-gray-500 hover:underline">← Home</Link>
      </nav>

      <header className="mb-12 border-b pb-6">
        <p className="text-sm text-gray-500">Tag</p>
        <h1 className="text-4xl font-bold tracking-tight">#{decodedTag}</h1>
      </header>

      <ul className="space-y-8">
        {posts.map((post) => (
          <li key={post.postId}>
            <Link href={`/${post.slug}`} className="block group">
              <h2 className="text-2xl font-semibold group-hover:underline">{post.title}</h2>
              {post.publishedAt && (
                <time dateTime={post.publishedAt} className="text-sm text-gray-500">
                  {formatDate(post.publishedAt, settings.dateFormat, settings.timezone)}
                </time>
              )}
              {post.excerpt && <p className="mt-2 text-gray-700">{post.excerpt}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
