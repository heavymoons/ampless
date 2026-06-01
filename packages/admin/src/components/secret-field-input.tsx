'use client'

// SecretFieldInput component (Phase 6a).
//
// Renders a single PluginSecretField in the admin plugin settings form.
// The admin UI can WRITE / DELETE secret values but NEVER reads them
// back — the "stored" state shows only a masked placeholder (••••••••).
//
// State-machine logic lives in `../lib/secret-field-input.ts` as pure
// functions, so it can be tested without jsdom (same pattern as
// `repeatable-field-editor.tsx`). This component is the thin shell.

import { useReducer, useId } from 'react'
import { resolveLocalized, type PluginSecretField } from 'ampless'
import { Button, Input, Label } from '@ampless/runtime/ui'
import { useLocale } from './i18n-provider.js'
import {
  initialSecretFieldState,
  secretFieldReducer,
  showStoredPlaceholder,
  showInput,
  currentInputValue,
  isBusy,
  type SecretFieldState,
} from '../lib/secret-field-input.js'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SecretFieldInputProps {
  /** Field manifest (type, key, label, description). No `default`. */
  field: PluginSecretField
  /**
   * Whether a value is currently stored in DDB for this field. Drives
   * the initial `unset` / `stored` state. Comes from `hasPluginSecret()`
   * called at mount time in the parent form. The actual value is never
   * fetched.
   */
  hasValue: boolean
  /**
   * Called when the user saves a new value. The parent form passes
   * `setPluginSecret(instanceId, field.key, value)`.
   */
  onSave(value: string): Promise<void>
  /**
   * Called when the user clears the stored value. The parent form
   * passes `clearPluginSecret(instanceId, field.key)`.
   */
  onClear(): Promise<void>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SecretFieldInput({ field, hasValue, onSave, onClear }: SecretFieldInputProps) {
  const locale = useLocale()
  const inputId = useId()

  const [state, dispatch] = useReducer(
    secretFieldReducer,
    hasValue,
    initialSecretFieldState
  )

  // ── handlers ──────────────────────────────────────────────────────────

  async function handleSave() {
    const value = currentInputValue(state)
    dispatch({ type: 'SAVE' })
    try {
      await onSave(value)
      dispatch({ type: 'SAVE_SUCCESS' })
    } catch (err) {
      dispatch({
        type: 'SAVE_ERROR',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function handleClear() {
    dispatch({ type: 'CLEAR' })
    try {
      await onClear()
      dispatch({ type: 'CLEAR_SUCCESS' })
    } catch (err) {
      dispatch({
        type: 'CLEAR_ERROR',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── render helpers ────────────────────────────────────────────────────

  const label = resolveLocalized(field.label, locale)
  const description = field.description ? resolveLocalized(field.description, locale) : undefined
  const busy = isBusy(state)

  return (
    <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      {/* Header row: lock icon + label */}
      <div className="flex items-center justify-between">
        <Label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium">
          <LockIcon />
          {label}
          {field.required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      </div>

      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}

      {/* Stored state: show masked placeholder + action buttons */}
      {showStoredPlaceholder(state) && (
        <div className="flex items-center gap-2">
          <span
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground"
            aria-label="Secret value is stored"
          >
            ••••••••
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => dispatch({ type: 'REPLACE' })}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void handleClear()}
            className="text-destructive hover:text-destructive"
          >
            Clear
          </Button>
        </div>
      )}

      {/* Input state: show text input + Save / Cancel */}
      {showInput(state) && (
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="text"
            className="flex-1"
            value={currentInputValue(state)}
            placeholder="Enter secret value…"
            maxLength={
              field.type === 'text' && field.maxLength ? field.maxLength : undefined
            }
            disabled={busy}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => dispatch({ type: 'CHANGE', value: e.target.value })}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || currentInputValue(state) === ''}
            onClick={() => void handleSave()}
          >
            {state.status === 'saving' ? 'Saving…' : 'Save'}
          </Button>
          {/* Show Cancel only when replacing an existing stored value */}
          {(state.status === 'editing' ||
            (state.status === 'error' && state.previousStatus === 'editing')) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => dispatch({ type: 'CANCEL' })}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      {/* Clearing spinner */}
      {state.status === 'clearing' && (
        <p className="text-xs text-muted-foreground">Clearing…</p>
      )}

      {/* Error message */}
      {state.status === 'error' && (
        <p className="text-xs text-destructive">{state.message}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v4.5A2.5 2.5 0 0 0 4.5 15h7a2.5 2.5 0 0 0 2.5-2.5V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5V4.5a2 2 0 1 0-4 0V6h4Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

// Re-export state types so the parent form can use them
export type { SecretFieldState }
