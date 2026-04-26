import type { Post } from './types.js'
import { DUMMY_POSTS } from './dummy.js'

export interface ListOptions {
  siteId?: string
  limit?: number
}

function isBackendConfigured(): boolean {
  return typeof process !== 'undefined' && !!process.env.AMPLESS_AMPLIFY_CONFIGURED
}

export async function listPosts(opts: ListOptions = {}): Promise<Post[]> {
  const { siteId = 'default', limit } = opts

  if (!isBackendConfigured()) {
    const posts = DUMMY_POSTS.filter((p) => p.siteId === siteId && p.status === 'published')
    return limit ? posts.slice(0, limit) : posts
  }

  throw new Error('DynamoDB-backed listPosts is not yet implemented (coming in Phase 4).')
}

export async function getPost(slug: string, opts: { siteId?: string } = {}): Promise<Post | null> {
  const { siteId = 'default' } = opts

  if (!isBackendConfigured()) {
    return DUMMY_POSTS.find((p) => p.siteId === siteId && p.slug === slug) ?? null
  }

  throw new Error('DynamoDB-backed getPost is not yet implemented (coming in Phase 4).')
}
