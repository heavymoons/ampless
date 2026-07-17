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
 * The MCP endpoint URL is pulled from `amplify_outputs.json` under
 * `custom.mcp.endpoint` — the `mcp-handler` Lambda Function URL that
 * `defineAmplessBackend` published via `backend.addOutput`. Missing on
 * fresh templates that haven't been deployed yet.
 */
export function createMcpTokensPage(admin: Admin) {
  async function McpTokensPage() {
    const session = await admin.getServerSession()
    if (!admin.isAdmin(session)) {
      redirect('/admin')
    }
    const mcpEndpoint = extractMcpEndpoint(admin.outputs)
    let publicMcpEndpoint: string | null | undefined
    if (admin.cmsConfig.ai?.publicMcp === true) {
      try {
        const settings = await admin.loadSiteSettings()
        publicMcpEndpoint = resolvePublicMcpEndpoint(true, settings.site.url)
      } catch (err) {
        console.error('[mcp-tokens] loadSiteSettings failed', err)
        publicMcpEndpoint = null
      }
    }
    return (
      <McpTokensView
        currentUserId={session!.userId}
        currentUserEmail={session!.email}
        mcpEndpoint={mcpEndpoint}
        publicMcpEndpoint={publicMcpEndpoint}
      />
    )
  }
  return McpTokensPage
}

export function resolvePublicMcpEndpoint(
  publicMcp: boolean | undefined,
  siteUrl: string | undefined,
): string | null | undefined {
  if (publicMcp !== true) return undefined
  if (!siteUrl?.trim()) return null
  try {
    const parsed = new URL(siteUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return new URL('/api/mcp', parsed).toString()
  } catch {
    return null
  }
}

function extractMcpEndpoint(outputs: Admin['outputs']): string | null {
  const custom = outputs.custom as { mcp?: { endpoint?: string } } | undefined
  return custom?.mcp?.endpoint ?? null
}
