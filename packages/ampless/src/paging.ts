// Bounded cursor-paging helper shared by any caller that needs to walk
// a `{ items, nextToken }` fetcher until it has collected `limit` items
// while staying protected against unbounded / looping scans.
//
// Originally the `collectPosts` walk inside
// `packages/runtime/src/routes/llms.ts`; lifted into `ampless` core so
// the public MCP tools (`@ampless/mcp-server/public`) can share the
// exact same semantics without depending on the runtime (the dependency
// arrow only points runtime/mcp-server → ampless).

/** How the scan ended. `null` = the fetcher was exhausted cleanly. */
export type BoundedScanTruncation = 'limit' | 'early' | null

export interface BoundedScanResult<T> {
  items: T[]
  /**
   * - `'limit'` — a `limit + 1`th item was actually fetched, so more
   *   items exist beyond the returned `limit`; the extra item is
   *   dropped from `items`.
   * - `'early'` — one of the safety bounds tripped (`maxPages` reached
   *   or the same `nextToken` came back twice), so the scan may have
   *   stopped with more items unread.
   * - `null` — the fetcher signalled exhaustion (no `nextToken`) at or
   *   below `limit`.
   */
  truncated: BoundedScanTruncation
}

export interface BoundedScanOptions {
  /**
   * Target item count. The walk collects until it has `limit + 1`
   * items (the extra confirms there really are more), the fetcher is
   * exhausted, or a safety bound trips.
   */
  limit: number
  /** Max items requested per page (default 50). */
  pageSizeCap?: number
  /** Hard cap on pages walked regardless of items collected (default 21). */
  maxPages?: number
}

export interface BoundedScanPage<T> {
  items: T[]
  nextToken: string | null
}

const DEFAULT_PAGE_SIZE_CAP = 50
const DEFAULT_MAX_PAGES = 21

// The three bounds are part of the public contract: callers must clamp
// / integer-ise their own inputs before calling. We reject anything
// that isn't a finite positive integer outright rather than silently
// flooring — a NaN / Infinity / 0 / negative / fractional bound almost
// always signals a bug upstream, and a quiet correction would hide it.
function requirePositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(
      `collectBounded: \`${name}\` must be a finite positive integer, received ${String(value)}`,
    )
  }
}

/**
 * Walk `fetchPage` pages until we have `limit + 1` items (the extra
 * item confirms there really are more items beyond `limit` — a present
 * `nextToken` alone doesn't guarantee that, since a paginated backend
 * can return a token alongside zero remaining items), the token is
 * exhausted, or one of the two safety bounds below trips:
 *
 *  - `maxPages` pages walked without reaching either stop condition
 *  - the same `nextToken` comes back twice (defends against a
 *    misbehaving resolver looping forever)
 *
 * Returns at most `limit` items (the confirming `limit + 1`th item is
 * dropped) alongside how the scan ended.
 */
export async function collectBounded<T>(
  fetchPage: (args: { limit: number; nextToken?: string }) => Promise<BoundedScanPage<T>>,
  opts: BoundedScanOptions,
): Promise<BoundedScanResult<T>> {
  const limit = opts.limit
  const pageSizeCap = opts.pageSizeCap ?? DEFAULT_PAGE_SIZE_CAP
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  requirePositiveInt('limit', limit)
  requirePositiveInt('pageSizeCap', pageSizeCap)
  requirePositiveInt('maxPages', maxPages)

  const items: T[] = []
  const seenTokens = new Set<string>()
  let token: string | undefined
  let truncated: BoundedScanTruncation = null

  for (let page = 0; page < maxPages; page++) {
    const remaining = limit + 1 - items.length
    const pageLimit = Math.min(pageSizeCap, remaining)
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchPage({ limit: pageLimit, nextToken: token })
    items.push(...res.items)

    if (items.length > limit) {
      truncated = 'limit'
      break
    }
    if (!res.nextToken) {
      break
    }
    if (seenTokens.has(res.nextToken)) {
      truncated = 'early'
      break
    }
    seenTokens.add(res.nextToken)
    token = res.nextToken

    if (page === maxPages - 1) {
      // Last allowed page produced neither a limit+1th item nor an
      // exhausted token — stopping here with (possibly) more left.
      truncated = 'early'
    }
  }

  return {
    items: truncated === 'limit' ? items.slice(0, limit) : items,
    truncated,
  }
}
