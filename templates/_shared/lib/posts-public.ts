// Back-compat shim. Implementation moved to `@ampless/runtime` (L1
// extraction). Theme files keep importing from `@/lib/posts-public`
// unchanged.
//
// New code should import from `@/lib/ampless` directly:
//   import { ampless } from '@/lib/ampless'
//   const posts = await ampless.listPublishedPosts({ siteId })

import { ampless } from './ampless'

export const listPublishedPosts = ampless.listPublishedPosts.bind(ampless)
export const getPublishedPost = ampless.getPublishedPost.bind(ampless)
export const listPostsByTag = ampless.listPostsByTag.bind(ampless)

export type {
  ListPostsOptions,
  ListPostsByTagOptions,
  ListPostsResult,
} from '@ampless/runtime'
