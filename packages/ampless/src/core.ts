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

/**
 * Options for a conditional `updatePost`: `expected` is the post exactly as
 * the caller read it (e.g. the `post` an editor was opened with). The
 * provider builds the store-side condition from it — at minimum its
 * `updatedAt`, and for the admin provider every content field as well, so
 * a concurrent write is detected even when it landed in the same
 * millisecond (equal `updatedAt`).
 */
export interface ConditionalPostUpdateOptions {
  expected: Post
}

/**
 * Thrown by a conditional `updatePost` when the stored post changed since
 * the caller read it (or is gone). Nothing was written.
 */
export class PostUpdateConflictError extends Error {
  readonly postId: string
  readonly expectedUpdatedAt: string

  constructor(postId: string, expectedUpdatedAt: string, options?: { cause?: unknown }) {
    super(
      `Post ${postId} was changed since it was read (expected updatedAt ${expectedUpdatedAt}); nothing was saved`,
      options,
    )
    this.name = 'PostUpdateConflictError'
    this.postId = postId
    this.expectedUpdatedAt = expectedUpdatedAt
  }
}

/**
 * Thrown by `updatePost(..., { expected })` when no conditional write is
 * possible: the configured provider has no `updateIfUnchanged`, the backend
 * lacks the conditional mutation (an un-upgraded deployment), or `expected`
 * carries no `updatedAt` to condition on. In every case NOTHING was
 * executed — a conditional update never falls back to an unconditional
 * write on its own; the caller decides what (if anything) is safe to do.
 */
export class ConditionalPostUpdateUnsupportedError extends Error {
  constructor(reason = 'The configured posts provider does not support conditional updates (updateIfUnchanged)') {
    super(reason)
    this.name = 'ConditionalPostUpdateUnsupportedError'
  }
}

export interface PostsProvider {
  list(opts?: ListOptions): Promise<Post[]>
  get(slug: string): Promise<Post | null>
  getById(postId: string): Promise<Post | null>
  create(data: CreatePostInput): Promise<Post>
  update(postId: string, data: Partial<Post>): Promise<Post>
  /**
   * Like `update`, but only writes when the stored post still matches
   * `options.expected` (checked atomically by the store in the same write,
   * not read-then-write). MUST throw `PostUpdateConflictError` when that
   * condition fails and `ConditionalPostUpdateUnsupportedError` when it
   * cannot condition the write at all, and must never write in either case.
   *
   * Optional: providers without it make conditional `updatePost` calls
   * throw `ConditionalPostUpdateUnsupportedError` (see
   * `supportsConditionalPostUpdate`). The admin provider implements it.
   */
  updateIfUnchanged?(
    postId: string,
    data: Partial<Post>,
    options: ConditionalPostUpdateOptions
  ): Promise<Post>
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

/**
 * Update a post. Without `options` this is the plain last-write-wins
 * `provider.update`. With `options.expected` the write is conditional
 * (`provider.updateIfUnchanged`): it throws `PostUpdateConflictError` when
 * the post changed since it was read, and
 * `ConditionalPostUpdateUnsupportedError` when no conditional write is
 * possible — it never degrades to an unconditional one.
 */
export async function updatePost(
  postId: string,
  data: Partial<Post>,
  options?: ConditionalPostUpdateOptions
): Promise<Post> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  if (!options) return provider.update(postId, data)
  if (!provider.updateIfUnchanged) throw new ConditionalPostUpdateUnsupportedError()
  return provider.updateIfUnchanged(postId, data, options)
}

/**
 * True when the provider implements `updateIfUnchanged`. A `true` does not
 * guarantee the backend supports it — `updatePost(..., { expected })` can
 * still throw `ConditionalPostUpdateUnsupportedError`.
 */
export function supportsConditionalPostUpdate(): boolean {
  return typeof provider?.updateIfUnchanged === 'function'
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
