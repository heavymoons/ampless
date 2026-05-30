// Pure helper functions for the RepeatableFieldEditor component.
//
// All state manipulation (parse / serialize / transform) lives here
// so it can be unit-tested with plain vitest — no jsdom required.
// The component itself is a thin shell that delegates to these helpers.

import type { PluginRepeatableField, PluginRepeatableSubField } from 'ampless'

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

/**
 * Parse the JSON form-string into a typed item list. Returns an empty
 * array on any error (malformed JSON, non-array root, etc.) so the
 * editor can always boot without crashing.
 */
export function parseRepeatableValue(raw: string): Array<Record<string, unknown>> {
  if (!raw || raw.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Keep only object items; drop non-objects silently.
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
    )
  } catch {
    return []
  }
}

/**
 * Serialize a typed item list back into the JSON string that the form
 * contract (value prop / onChange) uses. Always produces valid JSON.
 */
export function serializeRepeatableValue(items: ReadonlyArray<Record<string, unknown>>): string {
  return JSON.stringify(items)
}

// ---------------------------------------------------------------------------
// Cell-level type adapters
// ---------------------------------------------------------------------------

/**
 * Convert a typed sub-field cell value into the flat string that
 * `renderScalarInput` expects as its `value` prop.
 *   boolean → 'true' | 'false'
 *   number  → String(n)
 *   string  → s
 *   undefined / null → ''
 */
export function subFieldValueToFormString(
  _subField: PluginRepeatableSubField,
  value: unknown
): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  // Fallback for unexpected shapes
  return String(value)
}

/**
 * Inverse of `subFieldValueToFormString`. Reads the form-string for
 * one cell and returns the typed value that should be stored in the
 * item object.
 *   boolean sub-field: 'true' → true, anything else → false
 *   number sub-field:  parse as float, NaN → undefined
 *   all others:        raw string as-is (including empty string)
 */
export function formStringToSubFieldValue(
  subField: PluginRepeatableSubField,
  formString: string
): unknown {
  switch (subField.type) {
    case 'boolean':
      return formString === 'true'
    case 'number': {
      if (formString.trim() === '') return undefined
      const n = Number(formString)
      return Number.isNaN(n) ? undefined : n
    }
    default:
      // text, textarea, url, select — string as-is
      return formString
  }
}

// ---------------------------------------------------------------------------
// Item helpers
// ---------------------------------------------------------------------------

/**
 * Make a fresh empty item seeded with each sub-field's `default` (if
 * any). Used by the "+ Add item" button handler. Fields with no
 * default are omitted from the result (not set to `undefined`).
 *
 * Boolean sub-fields are a special case: their cell renders as an
 * unchecked checkbox when the value is absent (`undefined` rounds-trips
 * through `subFieldValueToFormString` → `''` → `value === 'true'` →
 * `false` in the renderer). If we left `undefined` in the item, the
 * user would see a `false` checkbox but the saved data would have no
 * key — strict validation then rejects required booleans as "absent",
 * and lenient resolve gives consumers `undefined` instead of the
 * `false` the form displayed. Seed an explicit `false` so form state,
 * stored state, and consumer reads all agree.
 */
export function makeEmptyItem(field: PluginRepeatableField): Record<string, unknown> {
  const item: Record<string, unknown> = {}
  for (const sf of field.fields) {
    if (sf.default !== undefined) {
      item[sf.key] = sf.default
      continue
    }
    if (sf.type === 'boolean') {
      // Match the unchecked checkbox the cell renders for absent boolean.
      item[sf.key] = false
    }
  }
  return item
}

/**
 * Display label for one item row. Uses `field.itemLabelKey` if set
 * and the resolved value is a non-empty string; otherwise falls back
 * to `Item ${index + 1}`.
 */
export function itemLabel(
  field: PluginRepeatableField,
  item: Record<string, unknown>,
  index: number
): string {
  if (field.itemLabelKey) {
    const v = item[field.itemLabelKey]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v)
    }
  }
  return `Item ${index + 1}`
}

/**
 * Returns true when the "+ Add item" button should be enabled —
 * i.e. the current count is strictly below the effective maxItems
 * cap (default 50).
 */
export function canAddItem(field: PluginRepeatableField, currentCount: number): boolean {
  const max = field.maxItems ?? 50
  return currentCount < max
}
