/**
 * Passkey (WebAuthn) sign-in helpers for the admin login screen.
 *
 * The browser-facing ceremony is run by Amplify's `signIn(USER_AUTH +
 * WEB_AUTHN)` — the SDK calls `navigator.credentials.get()` internally.
 * This module keeps the *testable* surface (capability detection, error
 * classification, result interpretation) as pure functions so the login
 * view stays a thin presentation layer.
 *
 * Registration / listing / deletion of credentials lives in
 * `passkey-store.ts` (the account page), which mirrors the injectable
 * `mcp-token-store` pattern.
 */

import { signIn } from 'aws-amplify/auth'
import type { AmplessOutputs } from '@ampless/runtime'

/** Cognito sign-in step that signals the account has no passkey yet. */
const FIRST_FACTOR_SELECTION = 'CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION'

/**
 * Reasons a passkey sign-in can fail, mapped to i18n keys under
 * `auth.passkey.*`. `failed` is the catch-all for anything we don't
 * recognise.
 */
export type PasskeyErrorKind = 'cancelled' | 'rpMismatch' | 'failed'

/**
 * Whether the current browser exposes the WebAuthn platform
 * authenticator API. Returns `false` during SSR (no `window`), so the
 * caller must set state in a `useEffect` to avoid hydration mismatch.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof navigator.credentials.get === 'function'
  )
}

/**
 * Map a thrown sign-in error to a stable `PasskeyErrorKind`. WebAuthn
 * surfaces `DOMException`s with well-known `.name`s:
 *
 *   - `NotAllowedError` — the user dismissed the OS prompt or it timed
 *     out (we treat both as a cancellation, not a hard failure).
 *   - `SecurityError` — the Relying Party ID doesn't match the origin,
 *     which on ampless almost always means a custom domain needs an
 *     explicit `relyingPartyId` in `amplify/auth/resource.custom.ts`.
 *
 * Anything else (including `UserCancelledException` from Cognito when no
 * credential is selected) falls through to `failed`.
 */
export function classifyPasskeyError(err: unknown): PasskeyErrorKind {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : ''
  if (name === 'NotAllowedError') return 'cancelled'
  if (name === 'SecurityError') return 'rpMismatch'
  return 'failed'
}

/** Narrowed result of a passkey sign-in attempt. */
export type PasskeySignInOutcome =
  | { status: 'signedIn' }
  | { status: 'noPasskey' }
  | { status: 'otherStep'; step: string }

/**
 * Interpret the `signIn` result. A fully-signed-in result means the
 * passkey ceremony succeeded. The `FIRST_FACTOR_SELECTION` step is
 * Cognito's way of saying "this user has no passkey, pick another
 * factor" — we surface it as `noPasskey` so the view can nudge the
 * operator to sign in with a password and register one. Any other
 * incomplete step is reported verbatim.
 */
export function interpretPasskeySignInResult(result: {
  isSignedIn: boolean
  nextStep: { signInStep: string }
}): PasskeySignInOutcome {
  if (result.isSignedIn) return { status: 'signedIn' }
  if (result.nextStep.signInStep === FIRST_FACTOR_SELECTION) {
    return { status: 'noPasskey' }
  }
  return { status: 'otherStep', step: result.nextStep.signInStep }
}

/**
 * Kick off a passkey sign-in for `username`. Amplify runs the WebAuthn
 * ceremony as part of this call (it asks Cognito for the challenge, then
 * invokes `navigator.credentials.get()`), so it must be triggered from a
 * user gesture (the button click) to satisfy Safari's requirement.
 */
export async function signInWithPasskey(username: string): Promise<PasskeySignInOutcome> {
  const result = await signIn({
    username,
    options: {
      authFlowType: 'USER_AUTH',
      preferredChallenge: 'WEB_AUTHN',
    },
  })
  return interpretPasskeySignInResult(result)
}

/**
 * Narrow helper — the shape of the auth.passwordless block we care about.
 * Kept local because `AmplessOutputs` is intentionally open-ended (`[key:
 * string]: unknown`) and the runtime comment says "narrow at call sites."
 */
type OutputsWithWebAuthn = {
  auth?: { passwordless?: { web_authn?: unknown } }
}

/**
 * Returns `true` when the deployed backend has WebAuthn (passkeys) enabled,
 * determined by the presence of `auth.passwordless.web_authn` in
 * `amplify_outputs.json`. The key is absent when `webAuthn: false` was set
 * in `amplify/auth/resource.custom.ts`.
 *
 * Use this to gate passkey UI so that disabling passkeys in the backend
 * removes the buttons entirely — no broken prompts or misleading UI.
 */
export function isWebAuthnEnabled(outputs: AmplessOutputs): boolean {
  const narrowed = outputs as OutputsWithWebAuthn
  return narrowed.auth?.passwordless?.web_authn != null
}
