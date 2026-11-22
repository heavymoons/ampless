import { describe, it, expect } from 'vitest'
import {
  getPostDisplayStatus,
  matchesStatusFilter,
  nextScheduledTransition,
  scheduledTransitionAt,
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

  it('missing / empty / null publishedAt falls back to the stored status', () => {
    expect(getPostDisplayStatus({ status: 'published' }, NOW)).toBe('published')
    expect(getPostDisplayStatus({ status: 'published', publishedAt: '' }, NOW)).toBe('published')
    expect(getPostDisplayStatus({ status: 'published', publishedAt: null }, NOW)).toBe('published')
  })

  it('compares by instant, like the public resolvers, for offset values', () => {
    // 20:30+09:00 is 11:30Z: past as an instant, though "20:30" > "12:00" as a string.
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-06-01T20:30:00+09:00' }, NOW)
    ).toBe('published')
    // 11:30-05:00 is 16:30Z: future as an instant, though "11:30" < "12:00" as a string.
    expect(
      getPostDisplayStatus({ status: 'published', publishedAt: '2026-06-01T11:30:00-05:00' }, NOW)
    ).toBe('scheduled')
  })

  it('offset value flips to published exactly at its instant', () => {
    const post = { status: 'published' as const, publishedAt: '2026-11-17T10:00:00+09:00' }
    const t = Date.UTC(2026, 10, 17, 1, 0, 0, 0)
    expect(scheduledTransitionAt(post, t - 1)).toBe(t)
    expect(getPostDisplayStatus(post, t - 1)).toBe('scheduled')
    expect(getPostDisplayStatus(post, t)).toBe('published')
  })

  it('value without milliseconds or seconds becomes visible at its instant', () => {
    const at = Date.UTC(2026, 10, 17, 1, 0, 0, 0)
    for (const publishedAt of ['2026-11-17T01:00:00Z', '2026-11-17T01:00Z']) {
      const post = { status: 'published' as const, publishedAt }
      expect(getPostDisplayStatus(post, at - 1)).toBe('scheduled')
      expect(scheduledTransitionAt(post, at - 1)).toBe(at)
      expect(getPostDisplayStatus(post, at)).toBe('published')
    }
  })

  it('unparseable values are scheduled with no transition (resolvers fail closed)', () => {
    for (const publishedAt of ['9999-12-31T23:59:59.999Zx', 'not-a-date', '2026-02-30T00:00:00Z']) {
      const post = { status: 'published' as const, publishedAt }
      expect(getPostDisplayStatus(post, NOW)).toBe('scheduled')
      expect(scheduledTransitionAt(post, NOW)).toBeUndefined()
      expect(nextScheduledTransition([post], NOW)).toBeUndefined()
    }
  })

  it('canonical values match the old Date-based comparison', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 500; i++) {
      const now = Date.UTC(2020, 0, 1) + Math.floor(rnd() * 3e11)
      const p = iso(now + Math.floor((rnd() - 0.5) * 2e7))
      const old = new Date(p).getTime() > now ? 'scheduled' : 'published'
      expect(getPostDisplayStatus({ status: 'published', publishedAt: p }, now)).toBe(old)
      if (old === 'scheduled') {
        expect(scheduledTransitionAt({ status: 'published', publishedAt: p }, now)).toBe(
          Date.parse(p)
        )
      }
    }
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
      { status: 'published' as const, publishedAt: iso(NOW + 2_000) },
      { status: 'published' as const, publishedAt: iso(NOW + 9_000) },
    ]
    expect(nextScheduledTransition(posts, NOW)).toBe(NOW + 2_000)
  })

  it('uses the instant for offset values', () => {
    const posts = [
      { status: 'published' as const, publishedAt: '2026-06-02T06:00:02+09:00' }, // 21:00:02Z on 06-01
      { status: 'published' as const, publishedAt: 'not-a-date' },
    ]
    expect(nextScheduledTransition(posts, NOW)).toBe(Date.UTC(2026, 5, 1, 21, 0, 2))
  })

  it('ignores drafts, past / equal-to-now, missing and never-visible publishedAt', () => {
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
