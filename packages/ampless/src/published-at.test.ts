import { describe, it, expect } from 'vitest'
import { canonicalizeAwsDateTime, parseAwsDateTime } from './published-at.js'

describe('parseAwsDateTime', () => {
  // Expected values match what AppSync's
  // util.time.parseISO8601ToEpochMilliSeconds returned for the same inputs
  // (verified with `aws appsync evaluate-code`).
  it.each([
    ['2026-01-01T00:00:00.000Z', 1767225600000],
    ['2026-01-01T09:00:00+09:00', 1767225600000],
    ['2026-01-01T00:00Z', 1767225600000],
    ['2026-01-01T00:00:00Z', 1767225600000],
    ['2026-01-01T00:00:00.123456789Z', 1767225600123],
    ['2026-01-01T00:00:00-05:00', 1767243600000],
    ['2026-01-01T09:00:00+09:00:30', 1767225570000],
    ['2026-01-01T00:00:00.5+01:00', 1767222000500],
  ])('parses %s', (input, expected) => {
    expect(parseAwsDateTime(input)).toBe(expected)
  })

  it.each([
    'not-a-date',
    '',
    '2026-01-01',
    '2026-01-01T00:00:00', // zone designator is mandatory
    '2026-01-01T00:00:00.000z',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+19:00',
    '2026-01-01T00:00:00+09:60',
    '2026-01-01T00:00:00.1234567890Z',
    '-2026-01-01T00:00:00Z',
    ' 2026-01-01T00:00:00Z',
  ])('rejects %j', (input) => {
    expect(parseAwsDateTime(input)).toBeUndefined()
  })

  it('rejects non-strings', () => {
    expect(parseAwsDateTime(undefined)).toBeUndefined()
    expect(parseAwsDateTime(null)).toBeUndefined()
    expect(parseAwsDateTime(1767225600000)).toBeUndefined()
  })

  it('accepts Feb 29 only in leap years', () => {
    expect(parseAwsDateTime('2028-02-29T00:00:00Z')).toBe(Date.UTC(2028, 1, 29))
    expect(parseAwsDateTime('2026-02-29T00:00:00Z')).toBeUndefined()
  })

  it('does not remap two-digit years', () => {
    expect(new Date(parseAwsDateTime('0050-01-01T00:00:00Z')!).getUTCFullYear()).toBe(50)
  })
})

describe('canonicalizeAwsDateTime', () => {
  it('converts offsets to fixed-width UTC', () => {
    expect(canonicalizeAwsDateTime('2026-01-01T09:00:00+09:00')).toBe('2026-01-01T00:00:00.000Z')
    expect(canonicalizeAwsDateTime('2026-01-01T00:00:00-05:00')).toBe('2026-01-01T05:00:00.000Z')
    expect(canonicalizeAwsDateTime('2026-01-01T00:00Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('leaves canonical values unchanged', () => {
    expect(canonicalizeAwsDateTime('2026-04-27T13:57:05.679Z')).toBe('2026-04-27T13:57:05.679Z')
  })

  it('returns undefined for unparseable input', () => {
    expect(canonicalizeAwsDateTime('not-a-date')).toBeUndefined()
  })

  it('returns undefined when the UTC instant leaves the 4-digit-year range', () => {
    expect(canonicalizeAwsDateTime('0000-01-01T00:00:00+01:00')).toBeUndefined()
    expect(canonicalizeAwsDateTime('9999-12-31T23:00:00-05:00')).toBeUndefined()
  })
})
