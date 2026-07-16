import type { Post } from 'ampless'

/**
 * The minimal, read-only surface the public MCP tools need. The runtime
 * (`@ampless/runtime`, PR-8) injects a concrete implementation backed by
 * its apiKey-mode `listPublishedPosts` / `getPublishedPost` (which strip
 * drafts server-side) and `postToMarkdown`.
 *
 * `listPostsByTag` is intentionally excluded: `list_tags` is served by
 * scanning + aggregating the published index, so the tool layer never
 * needs a tag-name-keyed lookup. Keeping the injected surface to three
 * methods minimises PR-8's wiring.
 */
export interface PublicToolContext {
  listPublishedPosts(opts: {
    limit?: number
    nextToken?: string
  }): Promise<{ items: Post[]; nextToken: string | null }>
  getPublishedPost(slug: string): Promise<Post | null>
  postToMarkdown(post: Post, opts?: { frontmatter?: boolean }): Promise<string>
}

/**
 * Field allowlist surfaced to anonymous callers. Deliberately omits
 * `postId`, `status`, `metadata`, and `body` — see `toPublicSummary`.
 */
export interface PublicPostSummary {
  slug: string
  title: string
  excerpt?: string
  tags?: string[]
  publishedAt?: string
  updatedAt?: string
  format: string
}

/**
 * Explicit pick — the core of the leakage defence. Never spread a
 * `Post` into the response: only the allowlisted fields below reach an
 * anonymous caller. `postId` / `status` / `metadata` / `body` are never
 * copied.
 */
export function toPublicSummary(post: Post): PublicPostSummary {
  const summary: PublicPostSummary = {
    slug: post.slug,
    title: post.title,
    format: post.format,
  }
  if (post.excerpt !== undefined) summary.excerpt = post.excerpt
  if (post.tags !== undefined) summary.tags = post.tags
  if (post.publishedAt !== undefined) summary.publishedAt = post.publishedAt
  if (post.updatedAt !== undefined) summary.updatedAt = post.updatedAt
  return summary
}
