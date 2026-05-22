// Back-compat shim. Implementation moved to `@ampless/runtime` (L1
// extraction). Theme files keep importing from `@/lib/posts-public`
// unchanged.
//
// New code should import from `@/lib/ampless` directly:
//   import { ampless } from '@/lib/ampless'
//   const posts = await ampless.listPublishedPosts()

import { ampless } from './ampless'

// Arrow function wrappers (not `.bind(ampless)`) so the `ampless`
// binding is read at call time, not at module evaluation. Module
// evaluation can run while `lib/ampless.ts` is still in its TDZ
// because the themes-registry → theme → shim → ampless dependency
// chain is circular by construction.
export const listPublishedPosts: typeof ampless.listPublishedPosts =
  (...args) => ampless.listPublishedPosts(...args)
export const getPublishedPost: typeof ampless.getPublishedPost =
  (...args) => ampless.getPublishedPost(...args)
export const listPostsByTag: typeof ampless.listPostsByTag =
  (...args) => ampless.listPostsByTag(...args)

export type {
  ListPostsOptions,
  ListPostsByTagOptions,
  ListPostsResult,
} from '@ampless/runtime'
