// Server-side post fetching for the public blog. Calls the custom
// `listPublishedPosts` / `getPublishedPost` queries — those resolvers
// hard-code the `status='published'` filter, so drafts are never exposed
// even if a guest hits the AppSync API directly.

import { cookies } from 'next/headers'
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/api'
import type { Post } from 'ampless'
import outputs from '../amplify_outputs.json'
import type { Schema } from '../amplify/data/resource'

const client = generateServerClientUsingCookies<Schema>({
  config: outputs,
  cookies,
  authMode: 'apiKey',
})

type RawPost = {
  siteId: string
  postId: string
  slug: string
  title: string
  excerpt?: string | null
  format?: string | null
  body?: unknown
  status?: string | null
  publishedAt?: string | null
  tags?: (string | null)[] | null
}

function decodeBody(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function toCorePost(p: RawPost): Post {
  return {
    postId: p.postId,
    siteId: p.siteId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: (p.format ?? 'markdown') as Post['format'],
    body: decodeBody(p.body),
    status: (p.status ?? 'draft') as Post['status'],
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
}

export async function listPublishedPosts(opts: { siteId?: string; limit?: number } = {}): Promise<
  Post[]
> {
  const { data, errors } = await client.queries.listPublishedPosts({
    siteId: opts.siteId ?? 'default',
    limit: opts.limit ?? 100,
  })
  if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts')
  return (data ?? [])
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => toCorePost(p as unknown as RawPost))
}

export async function getPublishedPost(
  slug: string,
  opts: { siteId?: string } = {}
): Promise<Post | null> {
  const { data, errors } = await client.queries.getPublishedPost({
    siteId: opts.siteId ?? 'default',
    slug,
  })
  if (errors) throw new Error(errors[0]?.message ?? 'Failed to get post')
  return data ? toCorePost(data as unknown as RawPost) : null
}
