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
 *
 * Note: the field is minute precision (`datetime-local`), so a value
 * the user actually edits is persisted at minute precision. To avoid
 * a no-op / unrelated edit silently truncating an existing value's
 * seconds/ms (which would also shift the public sort key), saving goes
 * through `resolvePublishedAtForSave`, which preserves the existing
 * value verbatim when the field was not touched.
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
// resolvePublishedAtForSave
// ---------------------------------------------------------------------------

export interface ResolvePublishedAtForSaveOpts {
  /** The status the post is being saved with. */
  status: 'draft' | 'published'
  /** Current `<input type="datetime-local">` value. */
  currentInput: string
  /**
   * The field's initial value at mount, i.e. `isoToLocalInput(existing)`.
   * Used to detect whether the user actually edited the field.
   */
  initialInput: string
  /** The post's current persisted `publishedAt`, if any. */
  existing?: string
}

/**
 * Decide the `publishedAt` to persist from raw form state.
 *
 * The key property: when the user did NOT touch the field
 * (`currentInput === initialInput`), the existing value is preserved
 * **verbatim** — including any sub-minute precision. This keeps an
 * unrelated edit (or a no-op save) from silently rewriting publishedAt
 * (and shifting the public sort key / scheduled time).
 *
 * When the field WAS edited, the new value is used at the field's minute
 * precision (an empty field falls back to the status default: stamp now
 * for a first publish, preserve existing for draft).
 */
export function resolvePublishedAtForSave({
  status,
  currentInput,
  initialInput,
  existing,
}: ResolvePublishedAtForSaveOpts): string | undefined {
  const touched = currentInput !== initialInput
  if (!touched) {
    // Field untouched: keep the stored value exactly (or apply the
    // first-publish default when there is nothing stored yet).
    return resolvePublishedAt({ status, inputIso: undefined, existing })
  }
  return resolvePublishedAt({
    status,
    inputIso: localInputToIso(currentInput),
    existing,
  })
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
