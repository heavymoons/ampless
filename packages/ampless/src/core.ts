import type { Post } from './types.js'
import { DUMMY_POSTS } from './dummy.js'

export interface ListOptions {
  siteId?: string
  limit?: number
  status?: 'draft' | 'published' | 'all'
}

export type CreatePostInput = Omit<Post, 'postId'> & { postId?: string }

export interface PostsProvider {
  list(opts?: ListOptions): Promise<Post[]>
  get(slug: string, opts?: { siteId?: string }): Promise<Post | null>
  getById(postId: string, opts?: { siteId?: string }): Promise<Post | null>
  create(data: CreatePostInput): Promise<Post>
  update(postId: string, data: Partial<Post>, opts?: { siteId?: string }): Promise<Post>
  remove(postId: string, opts?: { siteId?: string }): Promise<void>
}

let provider: PostsProvider | null = null

export function setPostsProvider(p: PostsProvider): void {
  provider = p
}

export function hasPostsProvider(): boolean {
  return provider !== null
}

function dummyList(opts: ListOptions = {}): Post[] {
  const { siteId = 'default', limit, status = 'published' } = opts
  let posts = DUMMY_POSTS.filter((p) => p.siteId === siteId)
  if (status !== 'all') posts = posts.filter((p) => p.status === status)
  return limit ? posts.slice(0, limit) : posts
}

export async function listPosts(opts: ListOptions = {}): Promise<Post[]> {
  if (provider) return provider.list(opts)
  return dummyList(opts)
}

export async function getPost(slug: string, opts: { siteId?: string } = {}): Promise<Post | null> {
  if (provider) return provider.get(slug, opts)
  const { siteId = 'default' } = opts
  return DUMMY_POSTS.find((p) => p.siteId === siteId && p.slug === slug) ?? null
}

export async function getPostById(
  postId: string,
  opts: { siteId?: string } = {}
): Promise<Post | null> {
  if (provider) return provider.getById(postId, opts)
  const { siteId = 'default' } = opts
  return DUMMY_POSTS.find((p) => p.siteId === siteId && p.postId === postId) ?? null
}

export async function createPost(data: CreatePostInput): Promise<Post> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  return provider.create(data)
}

export async function updatePost(
  postId: string,
  data: Partial<Post>,
  opts: { siteId?: string } = {}
): Promise<Post> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  return provider.update(postId, data, opts)
}

export async function deletePost(postId: string, opts: { siteId?: string } = {}): Promise<void> {
  if (!provider) throw new Error('No posts provider configured. Call setPostsProvider() first.')
  return provider.remove(postId, opts)
}
