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
 * Like the resolvers, the comparison is between INSTANTS: `publishedAt` is
 * an AWSDateTime that may carry an offset (`+09:00`), omit seconds, etc.
 * when written through the API directly, so it is parsed with
 * `parseAwsDateTime` (the same grammar AppSync accepts) rather than
 * compared as a string. A value that does not parse is hidden by the
 * resolvers (fail closed), so it shows as scheduled forever.
 *
 * Known gap: for a non-canonical positive-offset value the post's detail
 * and tag pages are live at its instant, but the `byStatus`-backed home
 * listing may only include it later (see list-published-posts.js); the
 * admin shows "published" from the instant onward.
 *
 * Pure module (no React, no DOM) so it can be unit-tested without jsdom.
 * `now` is passed in (epoch ms) so callers can re-render when it changes.
 */

import { parseAwsDateTime } from 'ampless'

export type PostDisplayStatus = 'draft' | 'scheduled' | 'published'

export type AdminPostStatusFilter = 'all' | PostDisplayStatus

interface PostStatusFields {
  status: 'draft' | 'published'
  publishedAt?: string | null
}

/**
 * Mirrors the resolvers' visibility rule (instant <= now is live; equal
 * counts as published; unparseable is never live). Draft / missing / empty
 * publishedAt is never scheduled.
 */
function isScheduled(post: PostStatusFields, now: number): boolean {
  if (post.status !== 'published' || !post.publishedAt) return false
  const t = parseAwsDateTime(post.publishedAt)
  return t === undefined || t > now
}

/**
 * Epoch ms of the instant at which a scheduled post becomes visible.
 * `undefined` when the post is not scheduled at `now`, or when it never
 * becomes visible (unparseable, such as `'not-a-date'`).
 */
export function scheduledTransitionAt(post: PostStatusFields, now: number): number | undefined {
  if (!isScheduled(post, now)) return undefined
  return parseAwsDateTime(post.publishedAt)
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
