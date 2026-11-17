import { describe, it, expect } from 'vitest'
import {
  getPostDisplayStatus,
  matchesStatusFilter,
  nextScheduledTransition,
  type AdminPostStatusFilter,
} from './post-display-status.js'

const NOW = Date.parse('2026-06-01T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('getPostDisplayStatus', () => {
  it('published with a future publishedAt is scheduled', () => {
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-06-02T00:00:00.000Z' }, NOW)
    ).toBe('scheduled')
  })

  it('published with a past publishedAt is published', () => {
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-05-01T00:00:00.000Z' }, NOW)
    ).toBe('published')
  })

  it('publishedAt exactly equal to now is published (server rule: publishedAt <= now)', () => {
    expect(getPostDisplayStatus({ status: 'published', publishedAt: iso(NOW) }, NOW)).toBe(
      'published'
    )
  })

  it('publishedAt 1ms after now is scheduled', () => {
    expect(getPostDisplayStatus({ status: 'published', publishedAt: iso(NOW + 1) }, NOW)).toBe(
      'scheduled'
    )
  })

  it('draft is never scheduled, even with a future publishedAt', () => {
    expect(
      getPostDisplayStatus({ status: 'draft', publishedAt: '2099-01-01T00:00:00.000Z' }, NOW)
    ).toBe('draft')
    expect(getPostDisplayStatus({ status: 'draft' }, NOW)).toBe('draft')
  })

  it('missing / empty / null / invalid publishedAt falls back to the stored status', () => {
    expect(getPostDisplayStatus({ status: 'published' }, NOW)).toBe('published')
    expect(getPostDisplayStatus({ status: 'published', publishedAt: '' }, NOW)).toBe('published')
    expect(getPostDisplayStatus({ status: 'published', publishedAt: null }, NOW)).toBe('published')
    expect(getPostDisplayStatus({ status: 'published', publishedAt: 'not-a-date' }, NOW)).toBe(
      'published'
    )
  })

  it('compares offset ISO strings by instant, not by string', () => {
    // 20:30+09:00 = 11:30Z → before NOW (12:00Z), although "20:30" > "12:00".
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-06-01T20:30:00+09:00' }, NOW)
    ).toBe('published')
    // 21:30+09:00 = 12:30Z → after NOW.
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-06-01T21:30:00+09:00' }, NOW)
    ).toBe('scheduled')
    // Exactly NOW expressed in +09:00.
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-06-01T21:00:00+09:00' }, NOW)
    ).toBe('published')
  })
})

describe('matchesStatusFilter', () => {
  const draft = { status: 'draft' as const, publishedAt: '2099-01-01T00:00:00.000Z' }
  const scheduled = { status: 'published' as const, publishedAt: iso(NOW + 60_000) }
  const published = { status: 'published' as const, publishedAt: iso(NOW - 60_000) }
  const all = [draft, scheduled, published]
  const pick = (filter: AdminPostStatusFilter) =>
    all.filter((p) => matchesStatusFilter(p, filter, NOW))

  it('all matches every post', () => {
    expect(pick('all')).toEqual(all)
  })

  it('published excludes scheduled posts', () => {
    expect(pick('published')).toEqual([published])
  })

  it('scheduled matches only future published posts', () => {
    expect(pick('scheduled')).toEqual([scheduled])
  })

  it('draft matches only drafts', () => {
    expect(pick('draft')).toEqual([draft])
  })

  it('a scheduled post moves to the published filter once now passes it', () => {
    const later = NOW + 60_000
    expect(matchesStatusFilter(scheduled, 'scheduled', later)).toBe(false)
    expect(matchesStatusFilter(scheduled, 'published', later)).toBe(true)
  })
})

describe('nextScheduledTransition', () => {
  it('returns the earliest future publishedAt among published posts', () => {
    const posts = [
      { status: 'published' as const, publishedAt: iso(NOW + 5_000) },
      { status: 'published' as const, publishedAt: '2026-06-01T21:00:02+09:00' }, // NOW + 2s
      { status: 'published' as const, publishedAt: iso(NOW + 9_000) },
    ]
    expect(nextScheduledTransition(posts, NOW)).toBe(NOW + 2_000)
  })

  it('ignores drafts, past / equal-to-now, missing and invalid publishedAt', () => {
    const posts = [
      { status: 'draft' as const, publishedAt: iso(NOW + 1_000) },
      { status: 'published' as const, publishedAt: iso(NOW - 1_000) },
      { status: 'published' as const, publishedAt: iso(NOW) },
      { status: 'published' as const },
      { status: 'published' as const, publishedAt: 'garbage' },
      { status: 'published' as const, publishedAt: iso(NOW + 7_000) },
    ]
    expect(nextScheduledTransition(posts, NOW)).toBe(NOW + 7_000)
  })

  it('returns undefined when nothing is scheduled', () => {
    expect(nextScheduledTransition([], NOW)).toBeUndefined()
    expect(
      nextScheduledTransition(
        [
          { status: 'draft', publishedAt: iso(NOW + 1_000) },
          { status: 'published', publishedAt: iso(NOW - 1_000) },
        ],
        NOW
      )
    ).toBeUndefined()
  })
})
