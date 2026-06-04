/**
 * Normalize a publishedAt value to canonical UTC ISO 8601 form
 * (`...Z`, millisecond precision).
 *
 * The `byStatus` GSI sort key and all AppSync JS resolver comparisons
 * (`publishedAt <= now`) rely on lexical ordering. ISO 8601 timestamps
 * are fixed-width to millisecond precision only when expressed in UTC Z
 * form — an offset like `+09:00` would mis-sort because `2026-06-04T21:00:00+09:00`
 * sorts alphabetically after `2026-06-04T12:00:00.000Z` even though they
 * represent the same instant.
 *
 * @throws {Error} when `value` cannot be parsed as a valid date.
 */
export function normalizePublishedAt(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid publishedAt: "${value}" could not be parsed as a date`)
  }
  return d.toISOString()
}
