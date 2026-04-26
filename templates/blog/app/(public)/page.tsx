import Link from 'next/link'
import { listPosts } from 'ampless'
import cmsConfig from '@/cms.config'

export default async function Home() {
  const posts = await listPosts()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-12 border-b pb-6">
        <h1 className="text-4xl font-bold tracking-tight">{cmsConfig.site.name}</h1>
        {cmsConfig.site.description && (
          <p className="mt-2 text-gray-600">{cmsConfig.site.description}</p>
        )}
      </header>

      <ul className="space-y-8">
        {posts.map((post) => (
          <li key={post.postId}>
            <Link href={`/${post.slug}`} className="block group">
              <h2 className="text-2xl font-semibold group-hover:underline">{post.title}</h2>
              {post.publishedAt && (
                <time className="text-sm text-gray-500">
                  {new Date(post.publishedAt).toLocaleDateString()}
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
