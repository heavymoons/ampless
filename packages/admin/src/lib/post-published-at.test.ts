/**
 * Unit tests for the publishedAt helper functions.
 *
 * These are pure-function tests with no DOM / jsdom requirement.
 *
 * Note on timezone:
 *   `isoToLocalInput` uses the test-runner's local wall-clock
 *   (getFullYear / getMonth / …). Round-trip assertions are therefore
 *   expressed as "localInputToIso(isoToLocalInput(x)) equals x" rather than
 *   asserting a specific UTC string — which would vary by machine timezone.
 *   For `resolvePublishedAt` the tests use fixed ISO strings that are
 *   timezone-independent by construction.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isoToLocalInput,
  localInputToIso,
  resolvePublishedAt,
  isFuture,
} from './post-published-at.js'

// ---------------------------------------------------------------------------
// isoToLocalInput
// ---------------------------------------------------------------------------

describe('isoToLocalInput', () => {
  it('returns empty string for undefined', () => {
    expect(isoToLocalInput(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(isoToLocalInput('')).toBe('')
  })

  it('returns empty string for an invalid date string', () => {
    expect(isoToLocalInput('not-a-date')).toBe('')
  })

  it('produces a string in YYYY-MM-DDTHH:mm format', () => {
    // Use a fixed UTC timestamp. What local time this represents depends on
    // the machine's tz, but the *shape* is always "YYYY-MM-DDTHH:mm".
    const result = isoToLocalInput('2026-01-15T10:30:00.000Z')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// localInputToIso
// ---------------------------------------------------------------------------

describe('localInputToIso', () => {
  it('returns undefined for empty string', () => {
    expect(localInputToIso('')).toBeUndefined()
  })

  it('returns undefined for an invalid datetime string', () => {
    expect(localInputToIso('not-a-date')).toBeUndefined()
  })

  it('returns an ISO string ending in Z for a valid datetime-local value', () => {
    // "2026-06-04T12:00" is a valid datetime-local string on all platforms.
    const result = localInputToIso('2026-06-04T12:00')
    expect(result).toBeDefined()
    expect(result!.endsWith('Z')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: isoToLocalInput ↔ localInputToIso
// ---------------------------------------------------------------------------

describe('round-trip isoToLocalInput / localInputToIso', () => {
  it('localInputToIso(isoToLocalInput(iso)) produces the same minute-precision UTC', () => {
    // Pick an ISO string that has exact minute precision so no rounding loss.
    const original = '2026-06-04T09:00:00.000Z'
    const localStr = isoToLocalInput(original)
    // localStr is now the machine-local representation — not necessarily the
    // UTC value. Round-tripping back should give us the same UTC millisecond
    // (within minute precision = same seconds = 00.000Z offset).
    const roundTripped = localInputToIso(localStr)
    expect(roundTripped).toBeDefined()

    // Both should represent the same point in time (within the minute).
    const origMs = new Date(original).getTime()
    const rtMs = new Date(roundTripped!).getTime()
    // The round-trip drops sub-minute precision (seconds/ms).
    // origMs truncated to the minute should equal rtMs.
    const truncatedOrig = origMs - (origMs % 60_000)
    const truncatedRt = rtMs - (rtMs % 60_000)
    expect(truncatedRt).toBe(truncatedOrig)
  })

  it('a datetime-local value round-trips to a Z ISO string', () => {
    const localInput = '2026-03-20T08:45'
    const iso = localInputToIso(localInput)
    expect(iso).toBeDefined()
    // Converting back to local and then to ISO again should be stable.
    const localAgain = isoToLocalInput(iso)
    expect(localAgain).toBe(localInput)
  })
})

// ---------------------------------------------------------------------------
// resolvePublishedAt
// ---------------------------------------------------------------------------

describe('resolvePublishedAt', () => {
  const EXISTING = '2026-01-01T00:00:00.000Z'
  const INPUT_ISO = '2026-07-04T12:00:00.000Z'

  it('inputIso always wins, even when existing is set', () => {
    const result = resolvePublishedAt({
      status: 'published',
      inputIso: INPUT_ISO,
      existing: EXISTING,
    })
    expect(result).toBe(INPUT_ISO)
  })

  it('inputIso wins even for draft status', () => {
    const result = resolvePublishedAt({
      status: 'draft',
      inputIso: INPUT_ISO,
      existing: EXISTING,
    })
    expect(result).toBe(INPUT_ISO)
  })

  it('published without inputIso stamps now when no existing', () => {
    const before = Date.now()
    const result = resolvePublishedAt({
      status: 'published',
      inputIso: undefined,
      existing: undefined,
    })
    const after = Date.now()
    expect(result).toBeDefined()
    const ts = new Date(result!).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('published without inputIso keeps existing when present (re-save does not overwrite)', () => {
    const result = resolvePublishedAt({
      status: 'published',
      inputIso: undefined,
      existing: EXISTING,
    })
    expect(result).toBe(EXISTING)
  })

  it('draft without inputIso preserves existing (never clears on revert-to-draft)', () => {
    const result = resolvePublishedAt({
      status: 'draft',
      inputIso: undefined,
      existing: EXISTING,
    })
    expect(result).toBe(EXISTING)
  })

  it('draft without inputIso returns undefined when no existing', () => {
    const result = resolvePublishedAt({
      status: 'draft',
      inputIso: undefined,
      existing: undefined,
    })
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isFuture
// ---------------------------------------------------------------------------

describe('isFuture', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false for undefined', () => {
    expect(isFuture(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isFuture('')).toBe(false)
  })

  it('returns false for invalid date string', () => {
    expect(isFuture('not-a-date')).toBe(false)
  })

  it('returns false for a past date', () => {
    expect(isFuture('2020-01-01T00:00:00.000Z')).toBe(false)
  })

  it('returns true for a future date', () => {
    // Far future to avoid any timing flakiness.
    expect(isFuture('2099-12-31T23:59:59.000Z')).toBe(true)
  })

  it('returns true for a date 1 hour from now (using fake timers)', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-04T10:00:00.000Z').getTime()
    vi.setSystemTime(now)
    const future = new Date(now + 60 * 60 * 1000).toISOString()
    expect(isFuture(future)).toBe(true)
  })

  it('returns false for a date 1 hour ago (using fake timers)', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-04T10:00:00.000Z').getTime()
    vi.setSystemTime(now)
    const past = new Date(now - 60 * 60 * 1000).toISOString()
    expect(isFuture(past)).toBe(false)
  })
})
