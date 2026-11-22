/**
 * Shared write limiter for the migration CLI's `--apply` flows (the
 * publishedAt rewrite and `--check-post-tags` repair).
 *
 * `acquire()` is awaited immediately BEFORE every write call (UpdateItem,
 * DeleteItem, TransactWriteItems), so consecutive writes start at least
 * `1000 / maxWritesPerSecond` ms apart — including the writes inside one
 * post's PostTag rebuild. There is no burst allowance: the first write goes
 * immediately, each later one waits for its slot. Concurrent callers are
 * serialized, so the spacing holds even if two writers share one limiter.
 */

export interface WriteLimiter {
  /** Resolves when the caller may issue its next write call. */
  acquire(): Promise<void>
}

export interface WriteLimiterOpts {
  /** Upper bound on write calls per second. Must be a positive number. */
  maxWritesPerSecond: number
  /** Injectable clock (ms). Default `Date.now`. */
  now?: () => number
  /** Injectable sleep. Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createWriteLimiter(opts: WriteLimiterOpts): WriteLimiter {
  const { maxWritesPerSecond } = opts
  if (!Number.isFinite(maxWritesPerSecond) || maxWritesPerSecond <= 0) {
    throw new Error(`maxWritesPerSecond must be a positive number (got ${maxWritesPerSecond})`)
  }
  const intervalMs = 1000 / maxWritesPerSecond
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? defaultSleep
  // Earliest start time of the next write.
  let nextAt = Number.NEGATIVE_INFINITY
  let queue: Promise<void> = Promise.resolve()

  return {
    acquire() {
      const turn = queue.then(async () => {
        const t = now()
        const slot = Math.max(t, nextAt)
        // setTimeout truncates fractional delays; round up so a write never
        // starts before its slot.
        if (slot > t) await sleep(Math.ceil(slot - t))
        nextAt = slot + intervalMs
      })
      // A failed sleep must not wedge later callers.
      queue = turn.catch(() => {})
      return turn
    },
  }
}
