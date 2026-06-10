import {
  decodeAwsJson,
  type Post,
  type PostSummary,
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
    updatedAt
    tags
    metadata
  }
`

export const POST_SUMMARY_FIELDS = /* GraphQL */ `
  fragment PostSummaryFields on Post {
    postId
    slug
    title
    excerpt
    format
    status
    publishedAt
    updatedAt
    tags
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
  updatedAt?: string | null
  tags?: (string | null)[] | null
  metadata?: unknown
}

interface RawPostSummary {
  postId: string
  slug: string
  title: string
  excerpt?: string | null
  format?: string | null
  status?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  tags?: (string | null)[] | null
}

/** PostSummary extended with `format`, always present in list_posts results. */
export type PostSummaryWithFormat = PostSummary & { format: Post['format'] }

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
    updatedAt: p.updatedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as PostMetadata)
        : undefined,
  }
}

export function toPostSummary(p: RawPostSummary): PostSummaryWithFormat {
  return {
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: ((p.format ?? 'markdown') as ContentFormat),
    status: ((p.status ?? 'draft') as PostStatus),
    publishedAt: p.publishedAt ?? undefined,
    updatedAt: p.updatedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
}
