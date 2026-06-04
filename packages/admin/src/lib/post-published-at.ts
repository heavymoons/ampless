/**
 * Pure helpers for the publishedAt field in the post form.
 *
 * These are kept in a plain module (no React, no DOM imports) so they can be
 * unit-tested with vitest without a jsdom environment.
 */

// ---------------------------------------------------------------------------
// isoToLocalInput
// ---------------------------------------------------------------------------

/**
 * Convert a stored ISO-UTC string to the value string for
 * `<input type="datetime-local">` in the browser-local wall-clock.
 *
 * Format: `YYYY-MM-DDTHH:mm`
 *
 * Returns `''` for empty, undefined, or invalid input.
 */
export function isoToLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const pad = (n: number) => String(n).padStart(2, '0')
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

// ---------------------------------------------------------------------------
// localInputToIso
// ---------------------------------------------------------------------------

/**
 * Convert a `datetime-local` value (local wall-clock, no tz) to canonical
 * ISO-UTC string.
 *
 * Returns `undefined` for empty or invalid input.
 */
export function localInputToIso(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// resolvePublishedAt
// ---------------------------------------------------------------------------

export interface ResolvePublishedAtOpts {
  /** The status the post is being saved with. */
  status: 'draft' | 'published'
  /**
   * ISO-UTC string produced by `localInputToIso(publishedAtInput)`.
   * `undefined` means the input was empty or invalid.
   */
  inputIso: string | undefined
  /** The post's current persisted `publishedAt`, if any. */
  existing?: string
}

/**
 * Determine the `publishedAt` value to persist.
 *
 * Rules:
 * 1. If `inputIso` is set → use it (human-chosen; may be in the future →
 *    scheduled publish).
 * 2. Else if `status === 'published'` → use `existing` if present, otherwise
 *    stamp now (first publish).
 * 3. Else (`status === 'draft'`) → preserve `existing` (never clear on
 *    revert-to-draft).
 */
export function resolvePublishedAt({
  status,
  inputIso,
  existing,
}: ResolvePublishedAtOpts): string | undefined {
  if (inputIso !== undefined) return inputIso
  if (status === 'published') return existing ?? new Date().toISOString()
  // draft — preserve whatever was there
  return existing
}

// ---------------------------------------------------------------------------
// isFuture
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `iso` parses to a valid date that is strictly in the
 * future (> Date.now()). Returns `false` for empty, invalid, or past/present
 * values.
 */
export function isFuture(iso?: string): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  return t > Date.now()
}
