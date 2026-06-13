import type { Admin } from '../index.js'
import { LoginPage } from '../components/login-view.js'
import { isWebAuthnEnabled } from '../lib/passkey.js'

/**
 * Login / sign-up / reset password page. The view is a client component
 * — this factory module stays server-side so `@ampless/admin/pages` can
 * be imported from Server Components and the `'use client'` boundary is
 * preserved at the cross-file reference.
 *
 * `passkeysEnabled` mirrors the ACTUAL deployed state: when `webAuthn:
 * false` is set in resource.custom.ts the key is absent from
 * `amplify_outputs.json` and the passkey button is removed entirely —
 * no broken prompts, no misleading UI.
 */
export function createLoginPage(admin: Admin) {
  const passkeysEnabled = isWebAuthnEnabled(admin.outputs)
  return function LoginPageWrapper() {
    return <LoginPage passkeysEnabled={passkeysEnabled} />
  }
}
