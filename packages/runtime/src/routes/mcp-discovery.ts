// Experimental MCP discovery routes.
//
// Two GET handlers advertise the opt-in public MCP endpoint so an AI
// client can find it without being handed the URL:
//
//   /.well-known/mcp/catalog.json  → the site-level catalog (one entry,
//        pointing at the Server Card). Reached via the middleware rewrite
//        of `/.well-known/mcp/catalog.json` → `/api/mcp/catalog.json`
//        (dot-free internal route; the App Router can't host a `.`-prefixed
//        folder cleanly, and the raw dotfile trips npm's packing quirk).
//   /api/mcp/server-card           → the Server Card (the spec's
//        recommended `<streamable-http-url>/server-card` placement).
//
// Both follow the prototype `experimental-ext-server-card` spec (SEP-2127,
// still open / unmerged), so the whole surface is gated behind the
// experimental `ai.mcpDiscovery` opt-in (on top of `ai.publicMcp`). The
// schema / paths may change to follow upstream.
//
// Gate order matters: the flag pair is a *synchronous* check made BEFORE
// any settings load, so a disabled site never pays an S3 read to 404. When
// enabled but the site URL can't resolve an absolute origin / a valid
// reverse-DNS identity, we 404 too (discovery only makes sense when we can
// advertise an absolute URL) and log one line.

import { resolvePublicMcpEndpoint } from 'ampless'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@ampless/mcp-server/jsonrpc'
import { corsHeaders, resolvePublicMcpIdentity, type PublicMcpIdentity } from './_mcp-shared.js'
import type { Ampless } from '../index.js'

export interface McpDiscoveryRouteHandlers {
  catalog: {
    GET: (request: Request) => Promise<Response>
    OPTIONS: (request: Request) => Promise<Response>
  }
  serverCard: {
    GET: (request: Request) => Promise<Response>
    OPTIONS: (request: Request) => Promise<Response>
  }
}

// Server Card / catalog identifiers from the vendored schema.
const CARD_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'
const CARD_CONTENT_TYPE = 'application/mcp-server-card+json'
const CATALOG_ENTRY_TYPE = 'application/mcp-server-card+json'

// Server Card string-field cap (schema: title / description maxLength 100).
const CARD_TEXT_MAX = 100

// Fixed English description text; `site.name` (when present) is prepended.
// Kept short enough to satisfy the 100-char cap on its own so an empty
// site name still yields a non-empty (minLength 1) description.
const DESCRIPTION_TEXT = 'read-only MCP endpoint for published posts (list, get, search, tags).'

// Collapse control chars / whitespace runs so an embedded newline in
// `site.name` can't break the single-line JSON field (same intent as the
// llms.txt normaliser).
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g
function normalizeText(s: string): string {
  return s.replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim()
}

// Truncate by Unicode code point, not UTF-16 code unit — `.slice()` cuts
// mid-surrogate-pair if a multi-unit character (e.g. an emoji) straddles
// the boundary, producing an unpaired surrogate (ill-formed string) in
// the JSON output. Spreading a string iterates by code point.
function truncate(s: string, max: number): string {
  const codePoints = [...s]
  return codePoints.length > max ? codePoints.slice(0, max).join('') : s
}

interface DiscoveryContext {
  origin: string
  hostname: string
  endpoint: string
  identity: PublicMcpIdentity
  siteName: string
}

/**
 * The experimental discovery surface requires BOTH flags. `publicMcp`
 * alone means the endpoint exists but isn't advertised via discovery;
 * `mcpDiscovery` alone is meaningless (nothing to advertise). Synchronous
 * so callers can 404 before any settings load.
 */
function discoveryEnabled(ampless: Ampless): boolean {
  return (
    ampless.cmsConfig.ai?.publicMcp === true && ampless.cmsConfig.ai?.mcpDiscovery === true
  )
}

/**
 * Load settings and resolve everything the two documents need (origin,
 * hostname, endpoint, reverse-DNS identity, site name). Returns `null`
 * when the endpoint can't be resolved to an absolute http(s) URL or the
 * identity fails the Card `name` constraints — callers 404 + warn.
 */
async function resolveContext(ampless: Ampless): Promise<DiscoveryContext | null> {
  const settings = await ampless.loadSiteSettings()
  const endpoint = resolvePublicMcpEndpoint(true, settings.site.url)
  if (typeof endpoint !== 'string') return null
  const identity = resolvePublicMcpIdentity(settings.site.url)
  if (!identity) return null
  // `.origin`/`.hostname` never carry userinfo, but `endpoint` itself
  // (and thus a naive `.toString()`/template of `parsed`) can if
  // `site.url` embeds `user:pass@`. Rebuild `endpoint` from `.origin` too
  // so the Card's `remotes[0].url` can't leak credentials either.
  const url = new URL(endpoint)
  const { origin, hostname } = url
  return {
    origin,
    hostname,
    endpoint: `${origin}/api/mcp`,
    identity,
    siteName: settings.site.name ?? '',
  }
}

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: corsHeaders('GET, OPTIONS'),
  })
}

function jsonResponse(body: unknown, contentType: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: corsHeaders('GET, OPTIONS', {
      'Content-Type': contentType,
      // Spec SHOULD value — discovery documents are cheap and stable.
      'Cache-Control': 'public, max-age=3600',
    }),
  })
}

/**
 * Build the discovery handlers. The template mounts the catalog handlers
 * at `app/api/mcp/catalog.json/route.ts` (middleware rewrite target) and
 * the server-card handlers at `app/api/mcp/server-card/route.ts`.
 */
export function createMcpDiscoveryRouteHandlers(ampless: Ampless): McpDiscoveryRouteHandlers {
  async function catalogGET(_request: Request): Promise<Response> {
    if (!discoveryEnabled(ampless)) return notFound()
    const ctx = await resolveContext(ampless)
    if (!ctx) {
      console.warn(
        '[ampless] MCP discovery catalog: site.url is unset or unresolvable — skipping (404)',
      )
      return notFound()
    }
    const body = {
      specVersion: 'draft',
      entries: [
        {
          // URN tail matches the Card name's `/`-suffix (`ampless-mcp`).
          identifier: `urn:air:${ctx.hostname}:ampless-mcp`,
          type: CATALOG_ENTRY_TYPE,
          url: `${ctx.origin}/api/mcp/server-card`,
        },
      ],
    }
    return jsonResponse(body, 'application/json')
  }

  async function serverCardGET(_request: Request): Promise<Response> {
    if (!discoveryEnabled(ampless)) return notFound()
    const ctx = await resolveContext(ampless)
    if (!ctx) {
      console.warn(
        '[ampless] MCP discovery server-card: site.url is unset or unresolvable — skipping (404)',
      )
      return notFound()
    }
    const normalizedName = normalizeText(ctx.siteName)
    const rawDescription = normalizedName
      ? `${normalizedName} — ${DESCRIPTION_TEXT}`
      : DESCRIPTION_TEXT

    const card: Record<string, unknown> = {
      $schema: CARD_SCHEMA_URL,
      name: ctx.identity.name,
      version: ctx.identity.version,
      description: truncate(rawDescription, CARD_TEXT_MAX),
    }
    // Omit `title` entirely when the site name is empty — `""` would
    // violate the schema's minLength: 1.
    if (normalizedName) card.title = truncate(normalizedName, CARD_TEXT_MAX)
    card.websiteUrl = ctx.origin
    card.remotes = [
      {
        type: 'streamable-http',
        url: ctx.endpoint,
        supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      },
    ]
    return jsonResponse(card, CARD_CONTENT_TYPE)
  }

  async function optionsHandler(_request: Request): Promise<Response> {
    if (!discoveryEnabled(ampless)) return notFound()
    return new Response(null, { status: 204, headers: corsHeaders('GET, OPTIONS') })
  }

  return {
    catalog: { GET: catalogGET, OPTIONS: optionsHandler },
    serverCard: { GET: serverCardGET, OPTIONS: optionsHandler },
  }
}
