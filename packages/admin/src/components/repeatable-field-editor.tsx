'use client'

// Repeatable-field editor for plugin settings (Phase 3b PR B).
//
// Renders a list of typed-object items, one per declared sub-field
// row. Each cell delegates rendering to `renderScalarInput` — the
// existing 8-variant scalar renderer extracted in Step 1 — so new
// scalar types are automatically supported here without any changes.
//
// All state-mutation logic (parse / serialize / label / guard) lives
// in `../lib/repeatable-field.ts` as pure functions, which lets them
// be unit-tested without a jsdom environment (the admin package
// vitest config has none).
//
// v1 deferred: drag-to-reorder, nested repeatable, per-item UUID.

import { useEffect, useState } from 'react'
import { resolveLocalized, type PluginRepeatableField } from 'ampless'
import { Label } from '@ampless/runtime/ui'
import { useLocale } from './i18n-provider.js'
import { renderScalarInput } from './scalar-input.js'
import {
  parseRepeatableValue,
  serializeRepeatableValue,
  subFieldValueToFormString,
  formStringToSubFieldValue,
  makeEmptyItem,
  itemLabel,
  canAddItem,
} from '../lib/repeatable-field.js'

interface RepeatableFieldEditorProps {
  field: PluginRepeatableField
  id: string
  /** JSON-serialized array, matches the string contract used by renderInput. */
  value: string
  invalid: boolean
  onChange: (v: string) => void
}

export function RepeatableFieldEditor({
  field,
  id,
  value,
  invalid,
  onChange,
}: RepeatableFieldEditorProps) {
  const locale = useLocale()

  const [items, setItems] = useState<Array<Record<string, unknown>>>(
    () => parseRepeatableValue(value)
  )

  // Sync external `value` changes (e.g. reset-to-default flow) into
  // local state. Use JSON.stringify comparison to avoid re-rendering
  // on every keystroke (the caller stringifies on each update).
  useEffect(() => {
    const incoming = parseRepeatableValue(value)
    if (JSON.stringify(incoming) !== JSON.stringify(items)) {
      setItems(incoming)
    }
    // Intentionally omit `items` from the deps array — we only want
    // to sync *downward* from prop changes, not chase our own writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function commit(next: Array<Record<string, unknown>>) {
    setItems(next)
    onChange(serializeRepeatableValue(next))
  }

  function updateCell(itemIdx: number, key: string, cellValue: unknown) {
    const next = items.map((item, idx) =>
      idx === itemIdx ? { ...item, [key]: cellValue } : item
    )
    commit(next)
  }

  function removeItem(itemIdx: number) {
    commit(items.filter((_, idx) => idx !== itemIdx))
  }

  function addItem() {
    if (!canAddItem(field, items.length)) return
    commit([...items, makeEmptyItem(field)])
  }

  const addLabelText = field.addLabel
    ? resolveLocalized(field.addLabel, locale)
    : '+ Add item'

  return (
    <div
      id={id}
      aria-invalid={invalid}
      className={[
        'space-y-3 rounded-md border p-3',
        invalid ? 'border-destructive' : 'border-border',
      ].join(' ')}
    >
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">No items yet.</p>
      )}

      {items.map((item, itemIdx) => {
        const label = itemLabel(field, item, itemIdx)
        return (
          <div
            key={itemIdx}
            className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{label}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                onClick={() => removeItem(itemIdx)}
                aria-label={`Remove ${label}`}
              >
                × Remove
              </button>
            </div>

            <div className="space-y-2">
              {field.fields.map((sf) => {
                const cellId = `${id}-${itemIdx}-${sf.key}`
                const formString = subFieldValueToFormString(sf, item[sf.key])
                return (
                  <div key={sf.key} className="space-y-1">
                    <Label htmlFor={cellId} className="text-xs">
                      {resolveLocalized(sf.label, locale)}
                      {sf.required && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </Label>
                    {renderScalarInput(
                      sf,
                      cellId,
                      formString,
                      /* invalid */ false,
                      (s) => updateCell(itemIdx, sf.key, formStringToSubFieldValue(sf, s))
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        onClick={addItem}
        disabled={!canAddItem(field, items.length)}
      >
        {addLabelText}
      </button>
    </div>
  )
}
