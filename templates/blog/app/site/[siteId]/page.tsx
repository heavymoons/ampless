import Link from 'next/link'
import { formatDate, siteFor } from 'ampless'
import cmsConfig from '@/cms.config'
import { listPublishedPosts } from '@/lib/posts-public'
import { TagList } from '@/components/tag-list'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string }>
}

export default async function Home({ params }: Props) {
  const { siteId } = await params
  const site = siteFor(siteId, cmsConfig)
  const { items: posts } = await listPublishedPosts({ siteId })

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-12 border-b pb-6">
        <h1 className="text-4xl font-bold tracking-tight">{site.name}</h1>
        {site.description && <p className="mt-2 text-gray-600">{site.description}</p>}
      </header>

      {posts.length === 0 ? (
        <p className="text-gray-500">No posts published yet.</p>
      ) : (
        <ul className="space-y-8">
          {posts.map((post) => (
            <li key={post.postId}>
              <Link href={`/${post.slug}`} className="block group">
                <h2 className="text-2xl font-semibold group-hover:underline">{post.title}</h2>
                {post.publishedAt && (
                  <time dateTime={post.publishedAt} className="text-sm text-gray-500">
                    {formatDate(post.publishedAt, cmsConfig.dateFormat, cmsConfig.timezone)}
                  </time>
                )}
                {post.excerpt && <p className="mt-2 text-gray-700">{post.excerpt}</p>}
              </Link>
              <TagList tags={post.tags} className="mt-3" />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
