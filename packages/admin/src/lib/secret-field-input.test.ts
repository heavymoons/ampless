import { describe, it, expect } from 'vitest'
import {
  initialSecretFieldState,
  secretFieldReducer,
  showStoredPlaceholder,
  showInput,
  currentInputValue,
  isBusy,
  type SecretFieldState,
} from './secret-field-input.js'

// ---------------------------------------------------------------------------
// initialSecretFieldState
// ---------------------------------------------------------------------------

describe('initialSecretFieldState', () => {
  it('returns unset when hasValue is false', () => {
    expect(initialSecretFieldState(false)).toEqual({ status: 'unset' })
  })

  it('returns stored when hasValue is true', () => {
    expect(initialSecretFieldState(true)).toEqual({ status: 'stored' })
  })
})

// ---------------------------------------------------------------------------
// secretFieldReducer — unset path (new value)
// ---------------------------------------------------------------------------

describe('secretFieldReducer — unset path', () => {
  it('CHANGE from unset → editing with the new value', () => {
    const s = secretFieldReducer({ status: 'unset' }, { type: 'CHANGE', value: 'my-secret' })
    expect(s).toEqual({ status: 'editing', value: 'my-secret' })
  })

  it('SAVE from editing → saving', () => {
    let s: SecretFieldState = { status: 'editing', value: 'abc' }
    s = secretFieldReducer(s, { type: 'SAVE' })
    expect(s).toEqual({ status: 'saving', previousStatus: 'editing', value: 'abc' })
  })

  it('SAVE_SUCCESS from saving → stored', () => {
    let s: SecretFieldState = { status: 'saving', previousStatus: 'editing', value: 'abc' }
    s = secretFieldReducer(s, { type: 'SAVE_SUCCESS' })
    expect(s).toEqual({ status: 'stored' })
  })

  it('SAVE_ERROR from saving → error with previousStatus', () => {
    let s: SecretFieldState = { status: 'saving', previousStatus: 'unset', value: '' }
    s = secretFieldReducer(s, { type: 'SAVE_ERROR', message: 'Network failure' })
    expect(s).toEqual({
      status: 'error',
      previousStatus: 'unset',
      message: 'Network failure',
    })
  })
})

// ---------------------------------------------------------------------------
// secretFieldReducer — stored path (Replace / Clear)
// ---------------------------------------------------------------------------

describe('secretFieldReducer — stored path', () => {
  it('REPLACE from stored → editing with empty value', () => {
    const s = secretFieldReducer({ status: 'stored' }, { type: 'REPLACE' })
    expect(s).toEqual({ status: 'editing', value: '' })
  })

  it('CANCEL from editing → stored', () => {
    let s: SecretFieldState = { status: 'editing', value: 'new-value' }
    s = secretFieldReducer(s, { type: 'CANCEL' })
    expect(s).toEqual({ status: 'stored' })
  })

  it('CLEAR from stored → clearing', () => {
    const s = secretFieldReducer({ status: 'stored' }, { type: 'CLEAR' })
    expect(s).toEqual({ status: 'clearing' })
  })

  it('CLEAR_SUCCESS from clearing → unset', () => {
    let s: SecretFieldState = { status: 'clearing' }
    s = secretFieldReducer(s, { type: 'CLEAR_SUCCESS' })
    expect(s).toEqual({ status: 'unset' })
  })

  it('CLEAR_ERROR from clearing → error', () => {
    let s: SecretFieldState = { status: 'clearing' }
    s = secretFieldReducer(s, { type: 'CLEAR_ERROR', message: 'Delete failed' })
    expect(s).toEqual({
      status: 'error',
      previousStatus: 'stored',
      message: 'Delete failed',
    })
  })
})

// ---------------------------------------------------------------------------
// secretFieldReducer — invalid transitions (no-op)
// ---------------------------------------------------------------------------

describe('secretFieldReducer — invalid transitions are no-ops', () => {
  it('REPLACE from unset state is a no-op', () => {
    const s = secretFieldReducer({ status: 'unset' }, { type: 'REPLACE' })
    expect(s).toEqual({ status: 'unset' })
  })

  it('CANCEL from unset state is a no-op', () => {
    const s = secretFieldReducer({ status: 'unset' }, { type: 'CANCEL' })
    expect(s).toEqual({ status: 'unset' })
  })

  it('CLEAR from unset state is a no-op', () => {
    const s = secretFieldReducer({ status: 'unset' }, { type: 'CLEAR' })
    expect(s).toEqual({ status: 'unset' })
  })

  it('SAVE from stored state is a no-op', () => {
    const s = secretFieldReducer({ status: 'stored' }, { type: 'SAVE' })
    expect(s).toEqual({ status: 'stored' })
  })
})

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

describe('showStoredPlaceholder', () => {
  it('true for stored', () => expect(showStoredPlaceholder({ status: 'stored' })).toBe(true))
  it('true for clearing', () => expect(showStoredPlaceholder({ status: 'clearing' })).toBe(true))
  it('false for unset', () => expect(showStoredPlaceholder({ status: 'unset' })).toBe(false))
  it('false for editing', () =>
    expect(showStoredPlaceholder({ status: 'editing', value: '' })).toBe(false))
})

describe('showInput', () => {
  it('true for unset', () => expect(showInput({ status: 'unset' })).toBe(true))
  it('true for editing', () => expect(showInput({ status: 'editing', value: 'x' })).toBe(true))
  it('false for stored', () => expect(showInput({ status: 'stored' })).toBe(false))
  it('false for clearing', () => expect(showInput({ status: 'clearing' })).toBe(false))
  it('true for error with previousStatus unset', () =>
    expect(showInput({ status: 'error', previousStatus: 'unset', message: 'oops' })).toBe(true))
  it('false for error with previousStatus stored', () =>
    expect(showInput({ status: 'error', previousStatus: 'stored', message: 'oops' })).toBe(false))
})

describe('currentInputValue', () => {
  it('returns editing value', () =>
    expect(currentInputValue({ status: 'editing', value: 'hello' })).toBe('hello'))
  it('returns empty string for non-editing states', () => {
    expect(currentInputValue({ status: 'unset' })).toBe('')
    expect(currentInputValue({ status: 'stored' })).toBe('')
    expect(currentInputValue({ status: 'clearing' })).toBe('')
  })
})

describe('isBusy', () => {
  it('true for saving', () =>
    expect(isBusy({ status: 'saving', previousStatus: 'editing', value: '' })).toBe(true))
  it('true for clearing', () => expect(isBusy({ status: 'clearing' })).toBe(true))
  it('false for all other states', () => {
    expect(isBusy({ status: 'unset' })).toBe(false)
    expect(isBusy({ status: 'stored' })).toBe(false)
    expect(isBusy({ status: 'editing', value: '' })).toBe(false)
    expect(isBusy({ status: 'error', previousStatus: 'unset', message: '' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Full flow scenarios
// ---------------------------------------------------------------------------

describe('full flow — first-time save', () => {
  it('unset → type → save → success → stored', () => {
    let s: SecretFieldState = initialSecretFieldState(false)
    expect(s.status).toBe('unset')

    s = secretFieldReducer(s, { type: 'CHANGE', value: 'my-secret' })
    expect(s.status).toBe('editing')

    s = secretFieldReducer(s, { type: 'SAVE' })
    expect(s.status).toBe('saving')

    s = secretFieldReducer(s, { type: 'SAVE_SUCCESS' })
    expect(s.status).toBe('stored')
  })
})

describe('full flow — replace existing value', () => {
  it('stored → replace → type → save → success → stored', () => {
    let s: SecretFieldState = initialSecretFieldState(true)
    expect(s.status).toBe('stored')

    s = secretFieldReducer(s, { type: 'REPLACE' })
    expect(s).toEqual({ status: 'editing', value: '' })

    s = secretFieldReducer(s, { type: 'CHANGE', value: 'new-secret' })
    expect(s).toEqual({ status: 'editing', value: 'new-secret' })

    s = secretFieldReducer(s, { type: 'SAVE' })
    expect(s.status).toBe('saving')
    expect((s as { value: string }).value).toBe('new-secret')

    s = secretFieldReducer(s, { type: 'SAVE_SUCCESS' })
    expect(s.status).toBe('stored')
  })
})

describe('full flow — clear stored value', () => {
  it('stored → clear → success → unset', () => {
    let s: SecretFieldState = initialSecretFieldState(true)
    s = secretFieldReducer(s, { type: 'CLEAR' })
    expect(s.status).toBe('clearing')
    s = secretFieldReducer(s, { type: 'CLEAR_SUCCESS' })
    expect(s.status).toBe('unset')
  })
})

describe('full flow — cancel replace', () => {
  it('stored → replace → cancel → stored', () => {
    let s: SecretFieldState = initialSecretFieldState(true)
    s = secretFieldReducer(s, { type: 'REPLACE' })
    expect(s.status).toBe('editing')
    s = secretFieldReducer(s, { type: 'CANCEL' })
    expect(s.status).toBe('stored')
  })
})
