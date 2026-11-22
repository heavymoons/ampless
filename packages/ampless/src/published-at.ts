/**
 * Strict parsing of AppSync `AWSDateTime` strings (e.g. `Post.publishedAt`).
 *
 * AppSync accepts — and DynamoDB stores verbatim — any extended ISO 8601
 * date-time with a mandatory zone designator: `Z`, `±hh:mm`, or `±hh:mm:ss`,
 * with optional seconds and an optional 1-9 digit fraction. Such strings do
 * NOT sort lexically in chronological order (`2026-01-01T09:00:00+09:00` is
 * the same instant as `2026-01-01T00:00:00.000Z`), so anything that decides
 * "is this published yet?" or orders posts must compare instants, not
 * strings.
 *
 * The grammar here mirrors what `util.time.parseISO8601ToEpochMilliSeconds`
 * accepts inside AppSync JS resolvers (fraction truncated to milliseconds),
 * restricted to 4-digit years. Anything outside it returns `undefined` so
 * callers can fail closed (treat the post as not yet published).
 */

const AWS_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):(\d{2})(?::(\d{2}))?)$/

/** Largest zone offset accepted (matches java.time.ZoneOffset). */
const MAX_OFFSET_SECONDS = 18 * 60 * 60

/**
 * Parse an `AWSDateTime` string to epoch milliseconds. Returns `undefined`
 * for non-strings and for anything that is not a valid AWSDateTime
 * (including impossible calendar dates such as `2026-02-30`).
 */
export function parseAwsDateTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const m = AWS_DATE_TIME.exec(value)
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = m[6] === undefined ? 0 : Number(m[6])
  const ms = m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, '0'))
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return undefined
  }

  let offsetSeconds = 0
  if (m[8] === undefined) {
    const oh = Number(m[10])
    const om = Number(m[11])
    const os = m[12] === undefined ? 0 : Number(m[12])
    if (om > 59 || os > 59) return undefined
    offsetSeconds = oh * 3600 + om * 60 + os
    if (offsetSeconds > MAX_OFFSET_SECONDS) return undefined
    if (m[9] === '-') offsetSeconds = -offsetSeconds
  }

  // Build via setUTCFullYear so years 0000-0099 are not remapped to 19xx.
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  d.setUTCHours(hour, minute, second, ms)
  // Reject dates that rolled over (e.g. Feb 30 → Mar 2).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return undefined
  }
  return d.getTime() - offsetSeconds * 1000
}

/**
 * Canonical UTC form of an `AWSDateTime` (`YYYY-MM-DDTHH:mm:ss.sssZ`, the
 * same fixed-width shape as `util.time.nowISO8601()`), whose lexical order
 * equals chronological order. Returns `undefined` when `value` does not
 * parse, or when the instant falls outside the 4-digit-year range.
 */
export function canonicalizeAwsDateTime(value: unknown): string | undefined {
  const ms = parseAwsDateTime(value)
  if (ms === undefined) return undefined
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  if (year < 0 || year > 9999) return undefined
  return d.toISOString()
}
