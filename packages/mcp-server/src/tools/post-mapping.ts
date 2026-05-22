import type { Post, ContentFormat, PostStatus } from 'ampless'

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

export function decodeBody(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// AppSync's AWSJSON scalar requires a *JSON-encoded* string on the wire.
// That means a raw markdown body like `# Hello` must become `"# Hello"`
// (a JSON string literal) — sending the bare `# Hello` triggers AppSync's
//   `Variable 'body' has an invalid value`
// validator. So we always JSON.stringify on the way out, including for
// strings. Same rule the admin posts-provider uses; keep them aligned.
export function encodeBody(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export function toCorePost(p: RawPost): Post {
  return {
    siteId: p.siteId,
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: ((p.format ?? 'markdown') as ContentFormat),
    body: decodeBody(p.body),
    status: ((p.status ?? 'draft') as PostStatus),
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
}
