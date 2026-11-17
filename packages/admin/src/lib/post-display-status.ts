/**
 * Admin-only display status for posts.
 *
 * The stored `status` is only `draft | published`. A published post whose
 * `publishedAt` is still in the future is hidden by the public resolvers
 * (`templates/_shared/amplify/data/get-published-post.js` etc. treat a post
 * as visible iff `!publishedAt || publishedAt <= now`), so the admin shows
 * it as "scheduled" instead of "published". This is display-only — the
 * stored data and save logic are unchanged.
 *
 * Pure module (no React, no DOM) so it can be unit-tested without jsdom.
 * `now` is passed in (epoch ms) so callers can re-render when it changes.
 */

export type PostDisplayStatus = 'draft' | 'scheduled' | 'published'

export type AdminPostStatusFilter = 'all' | PostDisplayStatus

interface PostStatusFields {
  status: 'draft' | 'published'
  publishedAt?: string | null
}

/**
 * Epoch ms of a published post's scheduled publish time, or `undefined`
 * when the post is not scheduled (draft, missing / invalid publishedAt,
 * or publishedAt already reached). Compared as epoch ms so offsets like
 * `+09:00` and `Z` are handled the same way.
 */
function scheduledAt(post: PostStatusFields, now: number): number | undefined {
  if (post.status !== 'published' || !post.publishedAt) return undefined
  const t = new Date(post.publishedAt).getTime()
  if (Number.isNaN(t)) return undefined
  // Equal to now counts as published, mirroring `publishedAt <= now`.
  return t > now ? t : undefined
}

export function getPostDisplayStatus(post: PostStatusFields, now: number): PostDisplayStatus {
  if (post.status === 'draft') return 'draft'
  return scheduledAt(post, now) !== undefined ? 'scheduled' : 'published'
}

export function matchesStatusFilter(
  post: PostStatusFields,
  filter: AdminPostStatusFilter,
  now: number
): boolean {
  if (filter === 'all') return true
  return getPostDisplayStatus(post, now) === filter
}

/**
 * The earliest scheduled publish time (epoch ms, > now) among `posts`, or
 * `undefined` when nothing is scheduled. Used to arm a timer so labels flip
 * from "scheduled" to "published" while the page stays open.
 */
export function nextScheduledTransition(
  posts: readonly PostStatusFields[],
  now: number
): number | undefined {
  let next: number | undefined
  for (const post of posts) {
    const t = scheduledAt(post, now)
    if (t !== undefined && (next === undefined || t < next)) next = t
  }
  return next
}
