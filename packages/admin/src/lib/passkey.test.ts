// Tests for packages/admin/src/lib/passkey.ts
//
// Covers the pure helpers that the login view relies on:
//   1. classifyPasskeyError — DOMException .name → PasskeyErrorKind
//   2. interpretPasskeySignInResult — signIn result → outcome
//   3. signInWithPasskey — passes the USER_AUTH + WEB_AUTHN options and
//      threads the result through interpretPasskeySignInResult

import { beforeEach, describe, expect, it, vi } from 'vitest'

// `passkey.ts` imports `signIn` from 'aws-amplify/auth' at module load,
// which would otherwise try to read Amplify config. Mock it so the pure
// helpers can be imported and signInWithPasskey can be asserted on.
const signInMock = vi.hoisted(() => vi.fn())
vi.mock('aws-amplify/auth', () => ({ signIn: signInMock }))

import {
  classifyPasskeyError,
  interpretPasskeySignInResult,
  signInWithPasskey,
  isWebAuthnEnabled,
} from './passkey.js'

beforeEach(() => {
  signInMock.mockReset()
})

// ---------------------------------------------------------------------------
// classifyPasskeyError
// ---------------------------------------------------------------------------

describe('classifyPasskeyError', () => {
  it('maps NotAllowedError (dismissed / timed out) to "cancelled"', () => {
    expect(classifyPasskeyError({ name: 'NotAllowedError' })).toBe('cancelled')
    // A real DOMException carries the same .name.
    const ex = new DOMException('cancelled', 'NotAllowedError')
    expect(classifyPasskeyError(ex)).toBe('cancelled')
  })

  it('maps SecurityError (RP ID mismatch) to "rpMismatch"', () => {
    expect(classifyPasskeyError({ name: 'SecurityError' })).toBe('rpMismatch')
  })

  it('falls back to "failed" for unknown errors', () => {
    expect(classifyPasskeyError(new Error('boom'))).toBe('failed')
    expect(classifyPasskeyError({ name: 'UserCancelledException' })).toBe('failed')
    expect(classifyPasskeyError('a string')).toBe('failed')
    expect(classifyPasskeyError(null)).toBe('failed')
    expect(classifyPasskeyError(undefined)).toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// interpretPasskeySignInResult
// ---------------------------------------------------------------------------

describe('interpretPasskeySignInResult', () => {
  it('returns "signedIn" when the ceremony completes', () => {
    expect(
      interpretPasskeySignInResult({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })
    ).toEqual({ status: 'signedIn' })
  })

  it('returns "noPasskey" on FIRST_FACTOR_SELECTION (no credential registered)', () => {
    expect(
      interpretPasskeySignInResult({
        isSignedIn: false,
        nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION' },
      })
    ).toEqual({ status: 'noPasskey' })
  })

  it('returns "otherStep" with the step name for any other incomplete result', () => {
    expect(
      interpretPasskeySignInResult({
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
      })
    ).toEqual({ status: 'otherStep', step: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' })
  })
})

// ---------------------------------------------------------------------------
// signInWithPasskey
// ---------------------------------------------------------------------------

describe('signInWithPasskey', () => {
  it('calls signIn with the USER_AUTH + WEB_AUTHN options', async () => {
    signInMock.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })
    const outcome = await signInWithPasskey('operator@example.com')
    expect(signInMock).toHaveBeenCalledWith({
      username: 'operator@example.com',
      options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' },
    })
    expect(outcome).toEqual({ status: 'signedIn' })
  })

  it('surfaces a no-passkey account as "noPasskey"', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION' },
    })
    expect(await signInWithPasskey('operator@example.com')).toEqual({ status: 'noPasskey' })
  })

  it('propagates thrown ceremony errors to the caller', async () => {
    signInMock.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'))
    await expect(signInWithPasskey('operator@example.com')).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
  })
})

// ---------------------------------------------------------------------------
// isWebAuthnEnabled
// ---------------------------------------------------------------------------

describe('isWebAuthnEnabled', () => {
  it('returns true when web_authn object is present', () => {
    expect(
      isWebAuthnEnabled({
        auth: { passwordless: { web_authn: { relying_party_id: 'example.com', user_verification: 'required' } } },
      })
    ).toBe(true)
  })

  it('returns false when passwordless key is absent', () => {
    expect(isWebAuthnEnabled({ auth: {} })).toBe(false)
    expect(isWebAuthnEnabled({})).toBe(false)
  })

  it('returns false when web_authn is null', () => {
    expect(isWebAuthnEnabled({ auth: { passwordless: { web_authn: null } } })).toBe(false)
  })

  it('returns false when auth is absent', () => {
    expect(isWebAuthnEnabled({ storage: { bucket_name: 'foo', aws_region: 'us-east-1' } })).toBe(false)
  })
})
