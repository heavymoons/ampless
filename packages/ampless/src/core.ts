import type { ContentFormat, Post, PostMetadata, PostStatus } from './types.js'
import { DUMMY_POSTS } from './dummy.js'

export interface ListOptions {
  limit?: number
  status?: 'draft' | 'published' | 'all'
}

export type CreatePostInput = Omit<Post, 'postId'> & { postId?: string }

/**
 * One in-memory snapshot of a Post at save time, read back from the
 * `PostHistory` table (written by the event-dispatcher Lambda on each
 * Post INSERT/MODIFY — see packages/backend/src/events/dispatcher.ts).
 *
 * `body` is already decoded from its AWSJSON wire form (the provider
 * runs `decodeAwsJson` before handing the row up), so it matches the
 * `Post['body']` shape for the declared `format`.
 */
export interface PostRevision {
  /** Deterministic id `${postId}#${revisedAt}` — unique per save. */
  postHistoryId: string
  postId: string
  /** ISO 8601 save time. Also the `byPost` GSI sort key (newest-first). */
  revisedAt: string
  title?: string
  slug?: string
  excerpt?: string
  format?: ContentFormat
  body?: unknown
  status?: PostStatus
  publishedAt?: string
  tags?: string[]
  metadata?: PostMetadata
}

/** Pagination options for `listPostHistory`. */
export interface ListPostHistoryOptions {
  limit?: number
  nextToken?: string
}

/**
 * A page of revisions newest-first. `nextToken` feeds straight back into
 * `ListPostHistoryOptions.nextToken` for the next page; `undefined` means
 * no more rows.
 */
export interface PostRevisionConnection {
  items: PostRevision[]
  nextToken?: string
}

/**
 * Lightweight row for admin list views — excludes body / metadata.
 * Body fields (tiptap JSON, markdown source, etc.) can be tens of KB per post;
 * projecting them out cuts per-post transfer size by 90%+ at scale.
 *
 * For list views that only need title / slug / status / dates / tags,
 * use `listPostSummaries` instead of `listPosts`.
 *
 * Scale note: for single-site blogs (hundreds to low thousands of posts),
 * full client-side fetch + sort/search is fast and eliminates GSI complexity.
 * If a site grows to many thousands of posts, revisit with a
 * (status, updatedAt) GSI + server-side pagination.
 */
export interface PostSummary {
  postId: string
  slug: string
  title: string
  excerpt?: string
  status: 'draft' | 'published'
  publishedAt?: string
  updatedAt?: string
  tags: string[]
}

/** Options for `listPostSummaries`. */
export interface SummaryListOptions {
  /** default 'all' */
  status?: 'draft' | 'published' | 'all'
}

export interface PostsProvider {
  list(opts?: ListOptions): Promise<Post[]>
  get(slug: string): Promise<Post | null>
  getById(postId: string): Promise<Post | null>
  create(data: CreatePostInput): Promise<Post>
  update(postId: string, data: Partial<Post>): Promise<Post>
  remove(postId: string): Promise<void>
  listPostHistory(
    postId: string,
    options?: ListPostHistoryOptions
  ): Promise<PostRevisionConnection>
  /**
   * Return lightweight summaries for all posts (no body / metadata).
   * Implementations MUST page through all nextToken values to return the
   * complete list — the admin list view depends on this for accurate search
   * and sort.
   *
   * Optional: providers that do not implement this fall back to a best-effort
   * single-page result via `list()` (see `listPostSummaries` fallback path).
   * The admin provider always implements this.
   */
  listSummaries?(opts?: SummaryListOptions): Promise<PostSummary[]>
}

let provider: PostsProvider | null = null
let warnedSummaryFallback = false

export function setPostsProvider(p: PostsProvider): void {
  provider = p
}

export function hasPostsProvider(): boolean {
  return provider !== null
}

function dummyList(opts: ListOptions = {}): Post[] {
  const { limit, status = 'published' } = opts
  let posts = DUMMY_POSTS
  if (status !== 'all') posts = posts.filter((p) => p.status === status)
  return limit ? posts.slice(0, limit) : posts
}

export async function listPosts(opts: ListOptions = {}): Promise<Post[]> {
  if (provider) return provider.list(opts)
  return dummyList(opts)
}

export async function getPost(slug: string): Promise<Post | null> {
  if (provider) return provider.get(slug)
  return DUMMY_POSTS.find((p) => p.slug === slug) ?? null
}

export async function getPostById(postId: string): Promise<Post | null> {
  if (provider) return provider.getById(postId)
  return DUMMY_POSTS.find((p) => p.postId === postId) ?? null
}

export async function createPost(data: CreatePostInput): Promise<Post> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  return provider.create(data)
}

export async function updatePost(postId: string, data: Partial<Post>): Promise<Post> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  return provider.update(postId, data)
}

export async function deletePost(postId: string): Promise<void> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  return provider.remove(postId)
}

/**
 * List a post's revision history, newest-first. Backed by the
 * `PostHistory` `byPost` GSI. Requires a configured provider (the dummy
 * fallback has no history) — returns an empty connection otherwise so
 * callers (e.g. the admin history panel) degrade gracefully.
 */
export async function listPostHistory(
  postId: string,
  options?: ListPostHistoryOptions
): Promise<PostRevisionConnection> {
  if (!provider) return { items: [] }
  return provider.listPostHistory(postId, options)
}

/**
 * Return lightweight summaries for all posts (no body / metadata).
 *
 * Delegates to `provider.listSummaries()` when available — the admin
 * provider implements this with a full nextToken loop and selectionSet
 * projection, ensuring all posts are returned without fetching large body
 * fields.
 *
 * **Fallback**: if the configured provider does not implement `listSummaries`,
 * falls back to a single page from `provider.list({ status })`. This is
 * best-effort only — it returns at most one page of results (no pagination).
 * Providers that need complete summary lists MUST implement `listSummaries`.
 * A `console.warn` is emitted once to make this visible.
 *
 * If no provider is configured, maps DUMMY_POSTS to summaries.
 */
export async function listPostSummaries(opts?: SummaryListOptions): Promise<PostSummary[]> {
  const status = opts?.status ?? 'all'

  if (!provider) {
    // No provider — map dummy posts to summaries
    return dummyList({ status }).map(postToSummary)
  }

  if (provider.listSummaries) {
    return provider.listSummaries(opts)
  }

  // Fallback: best-effort single page via list(). No full pagination —
  // providers that need complete listings must implement listSummaries.
  if (!warnedSummaryFallback) {
    warnedSummaryFallback = true
    console.warn(
      '[ampless] listPostSummaries: provider does not implement listSummaries; ' +
        'falling back to a single-page best-effort via list(). ' +
        'Complete listings require the provider to implement listSummaries.'
    )
  }
  const posts = await provider.list({ status })
  return posts.map(postToSummary)
}

function postToSummary(p: Post): PostSummary {
  return {
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    status: p.status as 'draft' | 'published',
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    tags: p.tags ?? [],
  }
}
