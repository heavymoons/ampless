// Shared normalization for the opt-in public read-only MCP endpoint URL.
//
// Single implementation so the admin MCP tokens card and the `/llms.txt`
// route advertise exactly the same endpoint for the same site
// configuration — origin-based (the MCP route is mounted at the app
// root, so it must not inherit any path component `site.url` happens to
// carry), and only ever an `http:`/`https:` URL.

/**
 * Resolve the public MCP endpoint URL from the `ai.publicMcp` flag and the
 * effective site URL.
 *
 * - Returns `undefined` when `publicMcp` isn't `true` (the feature is off —
 *   callers use this to distinguish "not enabled" from "enabled but
 *   unresolvable").
 * - Returns `null` when `publicMcp` is `true` but `siteUrl` is missing,
 *   blank, unparsable, or not an `http:`/`https:` URL (e.g. `ftp://...`,
 *   `mailto:...`) — there is no safe absolute URL to advertise.
 * - Otherwise returns the absolute `/api/mcp` URL at `siteUrl`'s origin.
 */
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
