import { redirect } from 'next/navigation'
import type { Admin } from '../index.js'
import { McpTokensView } from '../components/mcp-tokens-view.js'

/**
 * Admin-only MCP token management page. Token issuance is sensitive —
 * only users in the `ampless-admin` Cognito group may access it.
 *
 * The session (userId + email) is resolved server-side here and threaded
 * into the client-only `McpTokensView` as plain props so the view never
 * needs to call Cognito itself.
 *
 * Sites are also pre-resolved here from `admin.adminSiteOptions()` so the
 * scope selector is populated without any extra client-side fetch.
 */
export function createMcpTokensPage(admin: Admin) {
  async function McpTokensPage() {
    const session = await admin.getServerSession()
    if (!admin.isAdmin(session)) {
      redirect('/admin')
    }
    const sites = admin.adminSiteOptions()
    return (
      <McpTokensView
        currentUserId={session!.userId}
        currentUserEmail={session!.email}
        sites={sites}
      />
    )
  }
  return McpTokensPage
}
