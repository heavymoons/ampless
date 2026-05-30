// Unit tests for repeatable-field.ts pure helpers.
//
// The admin package vitest config has no jsdom environment, so React
// component rendering is not testable here. All complex logic is
// extracted into these pure functions and tested exhaustively.

import { describe, it, expect } from 'vitest'
import type { PluginRepeatableField, PluginRepeatableSubField } from 'ampless'
import {
  parseRepeatableValue,
  serializeRepeatableValue,
  subFieldValueToFormString,
  formStringToSubFieldValue,
  makeEmptyItem,
  itemLabel,
  canAddItem,
} from './repeatable-field.js'

// ---------------------------------------------------------------------------
// Fixture sub-fields
// ---------------------------------------------------------------------------

const textSf: PluginRepeatableSubField = { type: 'text', key: 'name', label: 'Name' }
const boolSf: PluginRepeatableSubField = { type: 'boolean', key: 'enabled', label: 'Enabled' }
const numSf: PluginRepeatableSubField = { type: 'number', key: 'count', label: 'Count' }
const selectSf: PluginRepeatableSubField = {
  type: 'select',
  key: 'color',
  label: 'Color',
  options: [
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
  ],
}
const urlSf: PluginRepeatableSubField = { type: 'url', key: 'link', label: 'Link' }
const textareaSf: PluginRepeatableSubField = { type: 'textarea', key: 'bio', label: 'Bio' }

function makeField(
  overrides: Partial<PluginRepeatableField> = {}
): PluginRepeatableField {
  return {
    type: 'repeatable',
    key: 'items',
    label: 'Items',
    fields: [textSf, boolSf],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseRepeatableValue
// ---------------------------------------------------------------------------

describe('parseRepeatableValue', () => {
  it('parses empty array string', () => {
    expect(parseRepeatableValue('[]')).toEqual([])
  })

  it('parses an array with one item', () => {
    expect(parseRepeatableValue('[{"id":"x"}]')).toEqual([{ id: 'x' }])
  })

  it('parses multiple items', () => {
    const result = parseRepeatableValue('[{"a":1},{"b":2}]')
    expect(result).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('returns empty array for malformed JSON', () => {
    expect(parseRepeatableValue('not json')).toEqual([])
  })

  it('returns empty array for non-array JSON (object)', () => {
    expect(parseRepeatableValue('{"key":"value"}')).toEqual([])
  })

  it('returns empty array for non-array JSON (string)', () => {
    expect(parseRepeatableValue('"hello"')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseRepeatableValue('')).toEqual([])
  })

  it('drops non-object items (arrays, nulls) silently', () => {
    expect(parseRepeatableValue('[{"a":1},null,["nested"]]')).toEqual([{ a: 1 }])
  })
})

// ---------------------------------------------------------------------------
// serializeRepeatableValue
// ---------------------------------------------------------------------------

describe('serializeRepeatableValue', () => {
  it('serializes empty array', () => {
    expect(serializeRepeatableValue([])).toBe('[]')
  })

  it('serializes a single item', () => {
    expect(serializeRepeatableValue([{ id: 'analytics' }])).toBe('[{"id":"analytics"}]')
  })

  it('round-trips correctly: serialize then parse returns the same data', () => {
    const items = [{ name: 'Alice', count: 3 }, { name: 'Bob', count: 7 }]
    expect(parseRepeatableValue(serializeRepeatableValue(items))).toEqual(items)
  })
})

// ---------------------------------------------------------------------------
// subFieldValueToFormString
// ---------------------------------------------------------------------------

describe('subFieldValueToFormString', () => {
  it('text: passes string through', () => {
    expect(subFieldValueToFormString(textSf, 'hello')).toBe('hello')
  })

  it('text: undefined → empty string', () => {
    expect(subFieldValueToFormString(textSf, undefined)).toBe('')
  })

  it('boolean: true → "true"', () => {
    expect(subFieldValueToFormString(boolSf, true)).toBe('true')
  })

  it('boolean: false → "false"', () => {
    expect(subFieldValueToFormString(boolSf, false)).toBe('false')
  })

  it('boolean: undefined → ""', () => {
    expect(subFieldValueToFormString(boolSf, undefined)).toBe('')
  })

  it('number: 42 → "42"', () => {
    expect(subFieldValueToFormString(numSf, 42)).toBe('42')
  })

  it('number: 0 → "0"', () => {
    expect(subFieldValueToFormString(numSf, 0)).toBe('0')
  })

  it('number: undefined → ""', () => {
    expect(subFieldValueToFormString(numSf, undefined)).toBe('')
  })

  it('select: "opt1" → "opt1"', () => {
    expect(subFieldValueToFormString(selectSf, 'opt1')).toBe('opt1')
  })

  it('select: undefined → ""', () => {
    expect(subFieldValueToFormString(selectSf, undefined)).toBe('')
  })

  it('url: full url passes through', () => {
    expect(subFieldValueToFormString(urlSf, 'https://example.com')).toBe('https://example.com')
  })

  it('textarea: multi-line string passes through', () => {
    expect(subFieldValueToFormString(textareaSf, 'multi\nline')).toBe('multi\nline')
  })
})

// ---------------------------------------------------------------------------
// formStringToSubFieldValue
// ---------------------------------------------------------------------------

describe('formStringToSubFieldValue', () => {
  it('text: returns raw string', () => {
    expect(formStringToSubFieldValue(textSf, 'hello')).toBe('hello')
  })

  it('text: empty string returns empty string', () => {
    expect(formStringToSubFieldValue(textSf, '')).toBe('')
  })

  it('boolean: "true" → true', () => {
    expect(formStringToSubFieldValue(boolSf, 'true')).toBe(true)
  })

  it('boolean: "false" → false', () => {
    expect(formStringToSubFieldValue(boolSf, 'false')).toBe(false)
  })

  it('boolean: empty string → false (not truthy)', () => {
    expect(formStringToSubFieldValue(boolSf, '')).toBe(false)
  })

  it('number: "42" → 42', () => {
    expect(formStringToSubFieldValue(numSf, '42')).toBe(42)
  })

  it('number: "3.14" → 3.14', () => {
    expect(formStringToSubFieldValue(numSf, '3.14')).toBeCloseTo(3.14)
  })

  it('number: empty string → undefined', () => {
    expect(formStringToSubFieldValue(numSf, '')).toBeUndefined()
  })

  it('number: non-numeric string → undefined', () => {
    expect(formStringToSubFieldValue(numSf, 'abc')).toBeUndefined()
  })

  it('select: returns raw string', () => {
    expect(formStringToSubFieldValue(selectSf, 'opt1')).toBe('opt1')
  })

  it('select: empty string passes through', () => {
    expect(formStringToSubFieldValue(selectSf, '')).toBe('')
  })

  it('url: returns url string', () => {
    expect(formStringToSubFieldValue(urlSf, 'https://example.com')).toBe('https://example.com')
  })

  it('textarea: multi-line passes through', () => {
    expect(formStringToSubFieldValue(textareaSf, 'multi\nline')).toBe('multi\nline')
  })
})

// ---------------------------------------------------------------------------
// makeEmptyItem
// ---------------------------------------------------------------------------

describe('makeEmptyItem', () => {
  it('returns object with boolean sub-fields seeded false; non-boolean omitted', () => {
    // textSf (text) has no default → omitted; boolSf (boolean) has no
    // default → seeded false so the form's unchecked checkbox display
    // matches the stored value.
    const field = makeField({ fields: [textSf, boolSf] })
    expect(makeEmptyItem(field)).toEqual({ enabled: false })
  })

  it('seeds fields that have defaults', () => {
    const sfWithDefault: PluginRepeatableSubField = {
      type: 'boolean',
      key: 'active',
      label: 'Active',
      default: true,
    }
    const field = makeField({ fields: [textSf, sfWithDefault] })
    expect(makeEmptyItem(field)).toEqual({ active: true })
  })

  it('seeds only fields that have defaults (mixed)', () => {
    const textWithDefault: PluginRepeatableSubField = {
      type: 'text',
      key: 'id',
      label: 'ID',
      default: '',
    }
    const numWithDefault: PluginRepeatableSubField = {
      type: 'number',
      key: 'order',
      label: 'Order',
      default: 0,
    }
    const field = makeField({ fields: [textWithDefault, textSf, numWithDefault] })
    const item = makeEmptyItem(field)
    // textWithDefault and numWithDefault have defaults; textSf does not
    expect(item).toHaveProperty('id', '')
    expect(item).toHaveProperty('order', 0)
    expect(item).not.toHaveProperty('name')
  })

  it('required boolean without default is seeded false so strict save does not reject', () => {
    // The bug guard: if we left the key absent, the UI would render
    // an unchecked checkbox (false-looking) but admin save would
    // strict-reject the item as "required field missing". Seeding
    // false makes the displayed and stored states agree.
    const requiredBool: PluginRepeatableSubField = {
      type: 'boolean',
      key: 'essential',
      label: 'Essential',
      required: true,
    }
    const field = makeField({ fields: [requiredBool] })
    const item = makeEmptyItem(field)
    expect(item).toEqual({ essential: false })
    expect('essential' in item).toBe(true)
  })

  it('optional boolean without default is seeded false too (UI consistency)', () => {
    // Same reason as required-boolean case: even when validation
    // would tolerate an absent optional boolean, the form shows
    // false, so the stored data should match. Avoids "looks false /
    // is undefined" inconsistency in consumer reads.
    const optionalBool: PluginRepeatableSubField = {
      type: 'boolean',
      key: 'visible',
      label: 'Visible',
    }
    const field = makeField({ fields: [optionalBool] })
    expect(makeEmptyItem(field)).toEqual({ visible: false })
  })
})

// ---------------------------------------------------------------------------
// itemLabel
// ---------------------------------------------------------------------------

describe('itemLabel', () => {
  it('falls back to "Item 1" (1-indexed) when no itemLabelKey', () => {
    const field = makeField()
    expect(itemLabel(field, {}, 0)).toBe('Item 1')
  })

  it('falls back to "Item 3" for index 2', () => {
    const field = makeField()
    expect(itemLabel(field, { name: 'Alice' }, 2)).toBe('Item 3')
  })

  it('uses itemLabelKey value when present and non-empty', () => {
    const field = makeField({ itemLabelKey: 'id' })
    expect(itemLabel(field, { id: 'analytics' }, 0)).toBe('analytics')
  })

  it('falls back when itemLabelKey is set but value is undefined', () => {
    const field = makeField({ itemLabelKey: 'id' })
    expect(itemLabel(field, {}, 0)).toBe('Item 1')
  })

  it('falls back when itemLabelKey value is empty string', () => {
    const field = makeField({ itemLabelKey: 'name' })
    expect(itemLabel(field, { name: '' }, 0)).toBe('Item 1')
  })

  it('falls back when itemLabelKey value is null', () => {
    const field = makeField({ itemLabelKey: 'name' })
    expect(itemLabel(field, { name: null }, 0)).toBe('Item 1')
  })

  it('converts number itemLabelKey value to string', () => {
    const field = makeField({ itemLabelKey: 'order' })
    expect(itemLabel(field, { order: 42 }, 0)).toBe('42')
  })
})

// ---------------------------------------------------------------------------
// canAddItem
// ---------------------------------------------------------------------------

describe('canAddItem', () => {
  it('returns true when count is below default max (50)', () => {
    const field = makeField()
    expect(canAddItem(field, 49)).toBe(true)
  })

  it('returns false when count equals default max (50)', () => {
    const field = makeField()
    expect(canAddItem(field, 50)).toBe(false)
  })

  it('returns false when count exceeds default max', () => {
    const field = makeField()
    expect(canAddItem(field, 51)).toBe(false)
  })

  it('respects explicit maxItems', () => {
    const field = makeField({ maxItems: 3 })
    expect(canAddItem(field, 2)).toBe(true)
    expect(canAddItem(field, 3)).toBe(false)
  })

  it('returns true when count is 0 (empty)', () => {
    const field = makeField()
    expect(canAddItem(field, 0)).toBe(true)
  })

  it('returns true at maxItems - 1', () => {
    const field = makeField({ maxItems: 5 })
    expect(canAddItem(field, 4)).toBe(true)
  })
})
