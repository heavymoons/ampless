import type { Admin } from '../index.js'
import { AccountView } from '../components/account-view.js'
import { isWebAuthnEnabled } from '../lib/passkey.js'

/**
 * Per-user account page — manage your own passkeys (WebAuthn
 * credentials). Unlike the users / MCP-token pages this has no extra
 * admin gate: every signed-in operator manages their own credentials,
 * so the layout factory's editor gate is sufficient.
 *
 * The session email and `passkeysEnabled` flag are resolved server-side
 * and threaded into the client-only `AccountView` as plain props.
 * `passkeysEnabled` mirrors the deployed state so disabling passkeys in
 * the backend removes the UI entirely.
 */
export function createAccountPage(admin: Admin) {
  const passkeysEnabled = isWebAuthnEnabled(admin.outputs)
  async function AccountPage() {
    const session = await admin.getServerSession()
    return <AccountView currentUserEmail={session!.email} passkeysEnabled={passkeysEnabled} />
  }
  return AccountPage
}
