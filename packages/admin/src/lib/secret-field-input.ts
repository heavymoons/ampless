// Pure helper functions for the SecretFieldInput component (Phase 6a).
//
// All state-machine transitions live here so they can be unit-tested
// with plain vitest — no jsdom required (same pattern as
// `repeatable-field.ts` for RepeatableFieldEditor).

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * State of a single secret field input.
 *
 *   unset     → no value stored in DDB; shows an empty text input + Save.
 *   stored    → a value IS stored; shows the masked placeholder (••••••••)
 *               + Replace + Clear buttons. The actual value is never fetched.
 *   editing   → user clicked Replace; shows a text input + Save + Cancel.
 *   saving    → async save in progress.
 *   clearing  → async clear (Delete) in progress.
 *   error     → last async operation failed; retaining the previous visible
 *               state so the user can retry.
 */
export type SecretFieldState =
  | { status: 'unset' }
  | { status: 'stored' }
  | { status: 'editing'; value: string }
  | { status: 'saving'; previousStatus: 'unset' | 'stored' | 'editing'; value: string }
  | { status: 'clearing' }
  | { status: 'error'; previousStatus: 'unset' | 'stored' | 'editing'; message: string }

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SecretFieldAction =
  | { type: 'REPLACE' }
  | { type: 'CANCEL' }
  | { type: 'CHANGE'; value: string }
  | { type: 'SAVE' }
  | { type: 'CLEAR' }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_ERROR'; message: string }
  | { type: 'CLEAR_SUCCESS' }
  | { type: 'CLEAR_ERROR'; message: string }

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

/**
 * Create the initial state for a SecretFieldInput.
 * `hasValue` comes from `hasPluginSecret()` called at mount time.
 */
export function initialSecretFieldState(hasValue: boolean): SecretFieldState {
  return hasValue ? { status: 'stored' } : { status: 'unset' }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer for SecretFieldInput state transitions.
 * All state-machine logic lives here; the component is a thin shell.
 */
export function secretFieldReducer(
  state: SecretFieldState,
  action: SecretFieldAction
): SecretFieldState {
  switch (action.type) {
    case 'REPLACE':
      // Only valid from 'stored' state (clicking the "Replace" button).
      if (state.status !== 'stored') return state
      return { status: 'editing', value: '' }

    case 'CANCEL':
      // Cancel editing → go back to stored (the value in DDB was not changed).
      if (state.status !== 'editing') return state
      return { status: 'stored' }

    case 'CHANGE':
      // Update the draft input value while in editing or unset state.
      if (state.status === 'editing') return { status: 'editing', value: action.value }
      // Also handle the initial empty-input state where the user types directly.
      // Map this to an editing state so SAVE works.
      if (state.status === 'unset') return { status: 'editing', value: action.value }
      return state

    case 'SAVE': {
      // Begin the async save operation.
      if (state.status === 'unset') {
        // The user typed into the initial input without triggering REPLACE first.
        // This can happen when the CHANGE action transitions unset → editing.
        // We land here if the component calls SAVE directly.
        return { status: 'saving', previousStatus: 'unset', value: '' }
      }
      if (state.status === 'editing') {
        return { status: 'saving', previousStatus: 'editing', value: state.value }
      }
      return state
    }

    case 'CLEAR':
      // Begin the async clear operation. Valid from 'stored' or 'error'.
      if (state.status === 'stored') return { status: 'clearing' }
      if (state.status === 'error') return { status: 'clearing' }
      return state

    case 'SAVE_SUCCESS':
      // After a successful save, always show "stored".
      return { status: 'stored' }

    case 'SAVE_ERROR': {
      // Return to the previous state (unset or editing) with an error indicator.
      const prev =
        state.status === 'saving'
          ? state.previousStatus
          : ('unset' as const)
      return { status: 'error', previousStatus: prev, message: action.message }
    }

    case 'CLEAR_SUCCESS':
      // After a successful clear, the value no longer exists.
      return { status: 'unset' }

    case 'CLEAR_ERROR':
      // Keep editing context — user may want to retry clearing.
      return {
        status: 'error',
        previousStatus: 'stored',
        message: action.message,
      }
  }
}

// ---------------------------------------------------------------------------
// Derived helpers (pure, testable)
// ---------------------------------------------------------------------------

/** Returns true when the masked placeholder (••••••••) should be shown. */
export function showStoredPlaceholder(state: SecretFieldState): boolean {
  return state.status === 'stored' || state.status === 'clearing'
}

/** Returns true when the text input should be rendered. */
export function showInput(state: SecretFieldState): boolean {
  return (
    state.status === 'unset' ||
    state.status === 'editing' ||
    (state.status === 'error' && state.previousStatus !== 'stored')
  )
}

/** Returns the current draft input value (empty string when no active input). */
export function currentInputValue(state: SecretFieldState): string {
  if (state.status === 'editing') return state.value
  return ''
}

/** Returns true when any async operation is in flight. */
export function isBusy(state: SecretFieldState): boolean {
  return state.status === 'saving' || state.status === 'clearing'
}
