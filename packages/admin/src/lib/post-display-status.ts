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
 * The comparison intentionally mirrors the resolvers: it is a LEXICAL string
 * comparison against the canonical `new Date(now).toISOString()`
 * (`YYYY-MM-DDTHH:mm:ss.sssZ`, what `util.time.nowISO8601()` yields), not an
 * instant comparison. For canonical UTC values the two are identical. For
 * non-canonical stored values (offset `+09:00`, no milliseconds, ...) the
 * public side hides the post until the canonical now string is lexically
 * >= the stored string, so the admin shows that actual visibility rather
 * than the nominal instant. Unparseable strings follow the same rule
 * (`'not-a-date'` sorts after any ISO string, so it is scheduled forever).
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

/** Latest instant whose ISO string is still a 4-digit-year string. */
const MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999)
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Mirrors the resolvers' `publishedAt > nowISO` check (string comparison;
 * equal counts as published). Draft / missing / empty publishedAt is never
 * scheduled.
 */
function isScheduled(post: PostStatusFields, now: number): boolean {
  if (post.status !== 'published' || !post.publishedAt) return false
  return post.publishedAt > new Date(now).toISOString()
}

/**
 * Epoch ms of the first instant at which a scheduled post becomes visible,
 * i.e. the first ms `t` with `new Date(t).toISOString() >= publishedAt`.
 * `undefined` when the post is not scheduled at `now`, or when it never
 * becomes visible (beyond year 9999, or unparseable such as `'not-a-date'`).
 */
export function scheduledTransitionAt(post: PostStatusFields, now: number): number | undefined {
  if (!isScheduled(post, now)) return undefined
  const p = post.publishedAt!
  if (CANONICAL_ISO.test(p)) {
    const t = Date.parse(p)
    if (!Number.isNaN(t) && new Date(t).toISOString() === p) return t
  }
  // toISOString() is lexically monotonic over years 0000-9999, so binary
  // search for the first ms whose ISO string is >= p. iso(now) < p holds.
  if (new Date(MAX_MS).toISOString() < p) return undefined
  let lo = now // iso(lo) < p
  let hi = MAX_MS // iso(hi) >= p
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (new Date(mid).toISOString() >= p) hi = mid
    else lo = mid
  }
  return hi
}

export function getPostDisplayStatus(post: PostStatusFields, now: number): PostDisplayStatus {
  if (post.status === 'draft') return 'draft'
  return isScheduled(post, now) ? 'scheduled' : 'published'
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
 * The earliest transition time (epoch ms, > now) among scheduled `posts`, or
 * `undefined` when nothing is scheduled or no scheduled post ever becomes
 * visible. Used to arm a timer so labels flip
 * from "scheduled" to "published" while the page stays open.
 */
export function nextScheduledTransition(
  posts: readonly PostStatusFields[],
  now: number
): number | undefined {
  let next: number | undefined
  for (const post of posts) {
    const t = scheduledTransitionAt(post, now)
    if (t !== undefined && (next === undefined || t < next)) next = t
  }
  return next
}
