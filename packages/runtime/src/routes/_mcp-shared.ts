// Shared building blocks for the public MCP surface — the JSON-RPC
// endpoint (`public-mcp.ts`) and the experimental discovery routes
// (`mcp-discovery.ts`) both import from here. Kept as its own module so
// neither of those files has to import the other (no circular import).

/**
 * The version string advertised for the public MCP server. Used both as
 * the Server Card `version` and — when `ai.mcpDiscovery` is on — as the
 * `initialize` `serverInfo.version` so the two never disagree. Semver so
 * it is a valid Server Card `version` (the static, discovery-off default
 * stays `'0.2'`, which lives in `public-mcp.ts`).
 */
export const PUBLIC_MCP_SERVER_VERSION = '0.2.0'

// --- CORS ---------------------------------------------------------------
//
// Open CORS is safe on this surface: anonymous, read-only, published-only,
// and credential-free (same posture as the admin MCP transport). The
// `methods` argument lets the JSON-RPC endpoint advertise `POST, OPTIONS`
// and the discovery routes advertise `GET, OPTIONS` from one helper.

export function corsHeaders(
  methods: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'content-type, mcp-protocol-version',
    'Access-Control-Max-Age': '86400',
    ...extra,
  }
}

// --- Server identity (reverse-DNS name) ---------------------------------

// Server Card `name` constraints (mirrored from the vendored
// `server-card.schema.json` `$defs.ServerCard.name`): reverse-DNS with
// exactly one `/`, 3..200 chars, this character class. Validated here so
// a pathological `site.url` (e.g. a hostname long enough to blow the 200
// cap, or one that can't form a valid label) yields `null` rather than an
// out-of-spec Card.
const CARD_NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/
const CARD_NAME_MIN = 3
const CARD_NAME_MAX = 200

// Fixed second segment of the reverse-DNS name — matches the URN tail
// (`:ampless-mcp`) the catalog emits, and the `/`-suffix of the Card name.
const SERVER_NAME_SUFFIX = 'ampless-mcp'

export interface PublicMcpIdentity {
  name: string
  version: string
}

/**
 * Resolve the reverse-DNS Server Card identity from the effective
 * `site.url`. `https://ishinao.net` → `net.ishinao/ampless-mcp` (hostname
 * labels reversed; IDN hostnames arrive already punycoded via the URL
 * API). Returns `null` when `siteUrl` is missing / blank / not http(s), or
 * when the resulting name would violate the Card `name` pattern or length
 * (so callers can 404 rather than advertise an invalid Card).
 */
export function resolvePublicMcpIdentity(siteUrl: string | undefined): PublicMcpIdentity | null {
  if (!siteUrl?.trim()) return null
  let hostname: string
  try {
    const parsed = new URL(siteUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    hostname = parsed.hostname
  } catch {
    return null
  }
  const labels = hostname.split('.').filter(Boolean)
  if (labels.length === 0) return null
  const namespace = labels.reverse().join('.')
  const name = `${namespace}/${SERVER_NAME_SUFFIX}`
  if (name.length < CARD_NAME_MIN || name.length > CARD_NAME_MAX) return null
  if (!CARD_NAME_PATTERN.test(name)) return null
  return { name, version: PUBLIC_MCP_SERVER_VERSION }
}
