import type { DateFormat } from './types.js'

/**
 * Format a date for display in a fixed timezone. SSR-safe — the same
 * (input, format, timezone) tuple yields the same string on Node and in
 * the browser, so React hydration never drifts.
 *
 * @param input    Date, ISO string, or epoch ms
 * @param format   'iso' (YYYY-MM-DD), 'long' (April 27, 2026), 'locale'
 * @param timezone IANA TZ name. Default 'UTC'.
 */
export function formatDate(
  input: Date | string | number,
  format: DateFormat = 'iso',
  timezone: string = 'UTC'
): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''

  switch (format) {
    case 'iso':
      return isoInTimezone(d, timezone)
    case 'long':
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timezone,
      }).format(d)
    case 'locale':
      return new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(d)
    default:
      return d.toISOString()
  }
}

function isoInTimezone(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '00'
  const day = parts.find((p) => p.type === 'day')?.value ?? '00'
  return `${year}-${month}-${day}`
}
