import { decodeAwsJson, type Post, type ContentFormat, type PostStatus } from 'ampless'

export const POST_FIELDS = /* GraphQL */ `
  fragment PostFields on Post {
    siteId
    postId
    slug
    title
    excerpt
    format
    body
    status
    publishedAt
    tags
  }
`

interface RawPost {
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

export function toCorePost(p: RawPost): Post {
  return {
    siteId: p.siteId,
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: ((p.format ?? 'markdown') as ContentFormat),
    body: decodeAwsJson(p.body),
    status: ((p.status ?? 'draft') as PostStatus),
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
}
