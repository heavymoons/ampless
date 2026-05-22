import {
  decodeAwsJson,
  type Post,
  type PostMetadata,
  type ContentFormat,
  type PostStatus,
} from 'ampless'

export const POST_FIELDS = /* GraphQL */ `
  fragment PostFields on Post {
    postId
    slug
    title
    excerpt
    format
    body
    status
    publishedAt
    tags
    metadata
  }
`

interface RawPost {
  postId: string
  slug: string
  title: string
  excerpt?: string | null
  format?: string | null
  body?: unknown
  status?: string | null
  publishedAt?: string | null
  tags?: (string | null)[] | null
  metadata?: unknown
}

export function toCorePost(p: RawPost): Post {
  const metadata = decodeAwsJson(p.metadata)
  return {
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: ((p.format ?? 'markdown') as ContentFormat),
    body: decodeAwsJson(p.body),
    status: ((p.status ?? 'draft') as PostStatus),
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as PostMetadata)
        : undefined,
  }
}
