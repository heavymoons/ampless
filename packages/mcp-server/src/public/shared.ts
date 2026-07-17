import { collectBounded, type Post } from 'ampless'
import { ToolUserError } from '../jsonrpc/index.js'
import type { PublicToolContext } from './types.js'

// --- bounds shared across the public tools ---

/** Max markdown characters `get_post` returns before truncating. */
export const MAX_BODY_CHARS = 100_000

/** Recent posts a `search_posts` / `list_tags` scan will read at most. */
export const SEARCH_SCAN_LIMIT = 200

/** Items requested per AppSync page during a public scan. */
export const PUBLIC_PAGE_SIZE_CAP = 50

/**
 * Hard page cap for public scans. Anonymous body-bearing AppSync reads
 * can't be absorbed by a CDN, so this is tighter than the llms.txt walk
 * (21). 5 pages * 50 items = 250, comfortably covering SEARCH_SCAN_LIMIT.
 */
export const PUBLIC_SCAN_MAX_PAGES = 5

/** Max accepted `slug` length (defensive input bound). */
export const MAX_SLUG_LEN = 512

/** Max accepted opaque `cursor` length. */
export const MAX_CURSOR_LEN = 4096

/** Max accepted `query` length (longer is clamped, not rejected). */
export const MAX_QUERY_LEN = 256

// --- input coercion / validation ---

/**
 * Finite-integer clamp with a fallback. Anything non-finite (a bad
 * JSON-RPC arg like `"abc"` → NaN) falls back to `fallback`; finite
 * values are truncated and clamped into `[min, max]`.
 */
export function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** Validate a required `slug` argument. Throws on a bad type / length. */
export function validateSlug(v: unknown): string {
  if (typeof v !== 'string') {
    throw new ToolUserError('`slug` is required and must be a string')
  }
  if (v.length === 0) {
    throw new ToolUserError('`slug` must not be empty')
  }
  if (v.length > MAX_SLUG_LEN) {
    throw new ToolUserError(`\`slug\` must be at most ${MAX_SLUG_LEN} characters`)
  }
  return v
}

/** Validate an optional opaque `cursor`. Throws on a bad type / length. */
export function validateCursor(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') {
    throw new ToolUserError('`cursor` must be a string')
  }
  if (v.length > MAX_CURSOR_LEN) {
    throw new ToolUserError(`\`cursor\` must be at most ${MAX_CURSOR_LEN} characters`)
  }
  return v
}

/**
 * Validate a required `query`: trim, reject empty, clamp overlong to
 * `MAX_QUERY_LEN` (matching the input-schema maximum rather than
 * throwing).
 */
export function validateQuery(v: unknown): string {
  if (typeof v !== 'string') {
    throw new ToolUserError('`query` is required and must be a string')
  }
  const trimmed = v.trim()
  if (trimmed.length === 0) {
    throw new ToolUserError('`query` must not be empty')
  }
  return trimmed.length > MAX_QUERY_LEN ? trimmed.slice(0, MAX_QUERY_LEN) : trimmed
}

/**
 * Bounded scan of the published index shared by `search_posts` and
 * `list_tags`. Reads up to `SEARCH_SCAN_LIMIT` recent posts (newest
 * first, as `listPublishedPosts` returns them), capped at
 * `PUBLIC_SCAN_MAX_PAGES`. Returns whether the scan fell short of a
 * full walk (`scanTruncated`).
 */
export async function scanRecentPublished(
  ctx: PublicToolContext,
): Promise<{ posts: Post[]; scanTruncated: boolean }> {
  const { items, truncated } = await collectBounded<Post>(
    (args) => ctx.listPublishedPosts({ limit: args.limit, nextToken: args.nextToken }),
    {
      limit: SEARCH_SCAN_LIMIT,
      pageSizeCap: PUBLIC_PAGE_SIZE_CAP,
      maxPages: PUBLIC_SCAN_MAX_PAGES,
    },
  )
  return { posts: items, scanTruncated: truncated !== null }
}
