'use client'

import { useEffect, useState } from 'react'

// setTimeout stores the delay as a signed 32-bit int; larger values fire
// immediately. Clamp and re-arm instead.
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/**
 * Current time (epoch ms) that re-renders the caller once `nextChangeAt`
 * arrives, so time-dependent labels (e.g. "scheduled" → "published") flip
 * while the page is open. With `nextChangeAt` undefined no timer is armed.
 *
 * `nextChangeAt` may also be a function of the hook's current `now`, so a
 * caller can derive the next boundary from the same clock it renders with
 * (e.g. `useNow((now) => nextScheduledTransition(posts, now))`) without
 * referencing `now` before it exists.
 *
 * The initial `Date.now()` is safe from hydration mismatch here: every
 * consumer is a `'use client'` component that loads its posts after mount,
 * so nothing time-dependent is in the server-rendered HTML.
 */
export function useNow(
  nextChangeAt: number | undefined | ((now: number) => number | undefined)
): number {
  const [now, setNow] = useState(() => Date.now())
  const next = typeof nextChangeAt === 'function' ? nextChangeAt(now) : nextChangeAt

  useEffect(() => {
    if (next === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      // +1ms so `now` is strictly past the boundary (`publishedAt <= now`).
      const delay = Math.min(Math.max(next - Date.now() + 1, 0), MAX_TIMEOUT_MS)
      timer = setTimeout(() => {
        const current = Date.now()
        // Fired early because the delay was clamped — wait again.
        if (current <= next) {
          arm()
          return
        }
        setNow(current)
      }, delay)
    }
    arm()
    return () => clearTimeout(timer)
  }, [next])

  return now
}
