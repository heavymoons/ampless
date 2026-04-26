import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPost } from 'ampless'
import { renderBody } from '../../lib/posts'

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

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
          className="prose prose-neutral max-w-none"
          dangerouslySetInnerHTML={{ __html: renderBody(post) }}
        />
      </article>
    </main>
  )
}
