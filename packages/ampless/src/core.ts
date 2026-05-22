import type { Post } from './types.js'
import { DUMMY_POSTS } from './dummy.js'

export interface ListOptions {
  limit?: number
  status?: 'draft' | 'published' | 'all'
}

export type CreatePostInput = Omit<Post, 'postId'> & { postId?: string }

export interface PostsProvider {
  list(opts?: ListOptions): Promise<Post[]>
  get(slug: string): Promise<Post | null>
  getById(postId: string): Promise<Post | null>
  create(data: CreatePostInput): Promise<Post>
  update(postId: string, data: Partial<Post>): Promise<Post>
  remove(postId: string): Promise<void>
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
