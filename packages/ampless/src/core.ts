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
}

let provider: PostsProvider | null = null

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
