import { redirect } from 'next/navigation'
import type { Admin } from '../index.js'
import { McpTokensView } from '../components/mcp-tokens-view.js'

/**
 * Admin-only MCP token management page. Admin role required — token
 * issuance is sensitive enough that we don't surface it to editors.
 */
export function createMcpTokensPage(admin: Admin) {
  async function McpTokensPage() {
    const session = await admin.getServerSession()
    if (!admin.isAdmin(session)) {
      redirect('/admin')
    }
    // The service Cognito user creds are read at request time inside
    // the HTTP route — the page can't usefully check them here because
    // they're Lambda-only env vars. Just surface the docs link
    // unconditionally.
    return <McpTokensView />
  }
  return McpTokensPage
}
