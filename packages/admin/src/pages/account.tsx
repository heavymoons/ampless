import type { Admin } from '../index.js'
import { AccountView } from '../components/account-view.js'

/**
 * Per-user account page — manage your own passkeys (WebAuthn
 * credentials). Unlike the users / MCP-token pages this has no extra
 * admin gate: every signed-in operator manages their own credentials,
 * so the layout factory's editor gate is sufficient.
 *
 * The session email is resolved server-side and threaded into the
 * client-only `AccountView` as a plain prop.
 */
export function createAccountPage(admin: Admin) {
  async function AccountPage() {
    const session = await admin.getServerSession()
    return <AccountView currentUserEmail={session!.email} />
  }
  return AccountPage
}
