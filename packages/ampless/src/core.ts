import type { ContentFormat, Post, PostMetadata, PostStatus } from './types.js'
import { DUMMY_POSTS } from './dummy.js'
import { normalizePostClasses } from './theme.js'

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

/** Options for `updatePost` / `PostsProvider.update`. */
export interface UpdatePostOptions {
  /**
   * Compare-and-swap on the stored `updatedAt`: the write only succeeds if
   * the row's `updatedAt` still equals this value (`null` = the row has no
   * `updatedAt`). On a mismatch the provider writes nothing and throws
   * `PostUpdateConflictError`. Omit (`undefined`) for an unconditional write.
   */
  expectedUpdatedAt?: string | null
}

/**
 * Thrown by `updatePost` when `options.expectedUpdatedAt` no longer matches
 * the stored post: someone else saved it in between, and nothing was
 * written. Re-read the post and retry.
 */
export class PostUpdateConflictError extends Error {
  constructor(message = 'The post was modified by someone else; nothing was written.') {
    super(message)
    this.name = 'PostUpdateConflictError'
  }
}

/**
 * Thrown by `updatePost` when `options.expectedUpdatedAt` is given but the
 * configured provider does not declare `supportsConditionalUpdate: true`.
 * Nothing was written: the provider was not called, because an
 * unconditional write could silently overwrite a concurrent change.
 */
export class ConditionalUpdateUnsupportedError extends Error {
  constructor(
    message = 'The configured posts provider does not support conditional updates (supportsConditionalUpdate); nothing was written.'
  ) {
    super(message)
    this.name = 'ConditionalUpdateUnsupportedError'
  }
}

export interface PostsProvider {
  list(opts?: ListOptions): Promise<Post[]>
  get(slug: string): Promise<Post | null>
  getById(postId: string): Promise<Post | null>
  create(data: CreatePostInput): Promise<Post>
  /**
   * `true` declares that `update(id, data, { expectedUpdatedAt })` performs
   * an atomic compare-and-swap on the stored `updatedAt` and throws
   * `PostUpdateConflictError` on a mismatch, writing nothing. Without it,
   * `updatePost` refuses a call with `expectedUpdatedAt` (throwing
   * `ConditionalUpdateUnsupportedError` before calling `update`) instead of
   * risking an unconditional write. Plain updates are unaffected.
   */
  supportsConditionalUpdate?: boolean
  /**
   * `options` is optional so providers written before it existed still
   * type-check. It is only passed to a provider that declares
   * `supportsConditionalUpdate: true`, which MUST make the write
   * conditional and throw `PostUpdateConflictError` on a mismatch.
   */
  update(postId: string, data: Partial<Post>, options?: UpdatePostOptions): Promise<Post>
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

/**
 * Whether the configured provider declares `supportsConditionalUpdate:
 * true`, i.e. `updatePost(id, data, { expectedUpdatedAt })` will be
 * accepted. `false` when no provider is configured.
 */
export function supportsConditionalPostUpdate(): boolean {
  return provider?.supportsConditionalUpdate === true
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

export async function updatePost(
  postId: string,
  data: Partial<Post>,
  options?: UpdatePostOptions
): Promise<Post> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  // Without options, call exactly as before (two arguments).
  if (options === undefined) return provider.update(postId, data)
  // Fail closed: a provider that has not declared compare-and-swap support
  // may ignore `expectedUpdatedAt` and overwrite a concurrent change, so
  // refuse before calling it.
  if (options.expectedUpdatedAt !== undefined && provider.supportsConditionalUpdate !== true) {
    throw new ConditionalUpdateUnsupportedError()
  }
  return provider.update(postId, data, options)
}

/** Result of `mergePostMetadata`. */
export interface PostMetadataMergeResult {
  /** The merged metadata; `undefined` when empty. */
  metadata: PostMetadata | undefined
  /**
   * Top-level keys both sides changed differently and that could not be
   * merged. For each, `metadata` holds `theirs` only as a placeholder:
   * callers MUST NOT write when this is non-empty.
   */
  conflicts: string[]
}

/**
 * Three-way merge of a post's `metadata`, per top-level key. `base` is the
 * metadata an editor loaded, `mine` what it wants to write, `theirs` the
 * stored value now. Values compare deeply (by JSON); an absent key equals
 * an absent key.
 *
 * - `mine[k]` equals `base[k]` (the editor left it): take `theirs[k]`, so a
 *   concurrent change (e.g. MCP `update_post` setting `postClasses`)
 *   survives.
 * - `theirs[k]` equals `base[k]`, or equals `mine[k]`: take `mine[k]`
 *   (absent = the key is deleted).
 * - Both changed it differently: for `postClasses`, when base, mine and
 *   theirs are each absent or a clean id list (unchanged by
 *   `normalizePostClasses`), a three-way set merge: theirs in order, minus
 *   the ids mine removed from base, plus (in mine's order) the ids mine
 *   added that theirs lacks; an empty result deletes the key. Any other
 *   key, or a `postClasses` that is not clean, is reported in `conflicts`.
 */
export function mergePostMetadata(
  base: PostMetadata | undefined,
  mine: PostMetadata | undefined,
  theirs: PostMetadata | undefined
): PostMetadataMergeResult {
  const b = (base ?? {}) as Record<string, unknown>
  const m = (mine ?? {}) as Record<string, unknown>
  const t = (theirs ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const conflicts: string[] = []
  const keys = new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])
  for (const k of keys) {
    const bv = ownValue(b, k)
    const mv = ownValue(m, k)
    const tv = ownValue(t, k)
    let value: unknown
    if (sameValue(mv, bv)) value = tv
    else if (sameValue(tv, bv) || sameValue(mv, tv)) value = mv
    else if (k === 'postClasses' && isCleanIdList(bv) && isCleanIdList(mv) && isCleanIdList(tv)) {
      const merged = mergeIdLists(bv ?? [], mv ?? [], tv ?? [])
      value = merged.length > 0 ? merged : undefined
    } else {
      conflicts.push(k)
      value = tv
    }
    if (value !== undefined) out[k] = value
  }
  return {
    metadata: Object.keys(out).length > 0 ? (out as PostMetadata) : undefined,
    conflicts,
  }
}

function ownValue(x: Record<string, unknown>, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(x, k) ? x[k] : undefined
}

// Deep equality by JSON; `undefined` (absent) equals only `undefined`.
function sameValue(x: unknown, y: unknown): boolean {
  if (x === undefined || y === undefined) return x === y
  return JSON.stringify(x) === JSON.stringify(y)
}

function isCleanIdList(x: unknown): x is string[] | undefined {
  return x === undefined || (Array.isArray(x) && sameValue(normalizePostClasses(x), x))
}

function mergeIdLists(base: string[], mine: string[], theirs: string[]): string[] {
  const removedByMine = new Set(base.filter((id) => !mine.includes(id)))
  const out = theirs.filter((id) => !removedByMine.has(id))
  for (const id of mine) {
    if (!base.includes(id) && !out.includes(id)) out.push(id)
  }
  return out
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
