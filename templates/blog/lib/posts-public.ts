// Server-side post fetching for the public blog. Calls the custom
// `listPublishedPosts` / `getPublishedPost` queries — those resolvers
// hard-code the `status='published'` filter, so drafts are never exposed
// even if a guest hits the AppSync API directly.
//
// authMode is 'identityPool' so reads use the Cognito Identity Pool
// unauthenticated (guest) role. No rotating API key.

import { cookies } from 'next/headers'
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/api'
import type { Post } from 'ampless'
import outputs from '../amplify_outputs.json'
import type { Schema } from '../amplify/data/resource'

const client = generateServerClientUsingCookies<Schema>({
  config: outputs,
  cookies,
  authMode: 'identityPool',
})

// Derive the wire shape of a PublicPost directly from the generated client
// so we don't restate the schema or fall back to `as any` casts.
type ListResponse = Awaited<ReturnType<typeof client.queries.listPublishedPosts>>
type GetResponse = Awaited<ReturnType<typeof client.queries.getPublishedPost>>
type ListConnection = NonNullable<ListResponse['data']>
type PublicPostItem = NonNullable<NonNullable<ListConnection['items']>[number]>
type PublicPostSingle = NonNullable<GetResponse['data']>

export interface ListPostsOptions {
  siteId?: string
  /** ISO 8601 timestamp; SK lower bound (inclusive). */
  from?: string
  /** ISO 8601 timestamp; SK upper bound (inclusive). */
  to?: string
  limit?: number
  /** Opaque cursor returned by a previous call. */
  nextToken?: string
}

export interface ListPostsResult {
  items: Post[]
  nextToken: string | null
}

function decodeBody(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function toCorePost(p: PublicPostItem | PublicPostSingle): Post {
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

export async function listPublishedPosts(
  opts: ListPostsOptions = {}
): Promise<ListPostsResult> {
  const { data, errors } = await client.queries.listPublishedPosts({
    siteId: opts.siteId ?? 'default',
    from: opts.from,
    to: opts.to,
    limit: opts.limit ?? 20,
    nextToken: opts.nextToken,
  })
  if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts')
  const items = (data?.items ?? [])
    .filter((p): p is PublicPostItem => p !== null)
    .map(toCorePost)
  return { items, nextToken: data?.nextToken ?? null }
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
  return data ? toCorePost(data) : null
}

export interface ListPostsByTagOptions {
  siteId?: string
  limit?: number
  nextToken?: string
}

export async function listPostsByTag(
  tag: string,
  opts: ListPostsByTagOptions = {}
): Promise<ListPostsResult> {
  const { data, errors } = await client.queries.listPostsByTag({
    siteId: opts.siteId ?? 'default',
    tag,
    limit: opts.limit ?? 20,
    nextToken: opts.nextToken,
  })
  if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts by tag')
  const items = (data?.items ?? [])
    .filter((p): p is PublicPostItem => p !== null)
    .map(toCorePost)
  return { items, nextToken: data?.nextToken ?? null }
}
