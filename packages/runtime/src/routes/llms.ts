// Site-wide AI index at `/llms.txt` (llmstxt.org convention): a short
// front matter (site name / description) followed by a flat list of
// published posts, newest first, each linking to its `/<slug>.md`
// markdown projection.
//
// Mounted directly at `app/llms.txt/route.ts` — unlike `/raw`, `/md`,
// `/static` this isn't reached via a middleware rewrite, so (like
// `og.ts`) this route computes and sets its own `Cache-Control`.

import { collectBounded, resolvePublicMcpEndpoint, type Post } from 'ampless'
import type { Ampless } from '../index.js'

// File route is `app/llms.txt/route.ts` — no dynamic segments.
interface Ctx {
  params: Promise<Record<string, never>>
}

export type LlmsTxtRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

const DEFAULT_LIMIT = 100
const MIN_LIMIT = 1
const MAX_LIMIT = 1000

// Each page request never asks for more than this. `listPublishedPosts`
// reads the published index, which returns full bodies (not a summary
// projection) — a single DynamoDB page can already approach the 1MB
// response cap, so capping the per-request limit keeps any one AppSync
// round trip cheap even when `llmsTxt.limit` is configured large.
const PAGE_SIZE_CAP = 50

// Hard cap on how many pages we'll walk, independent of how many items
// we've collected. Large post bodies can shrink a single DynamoDB page
// down to a handful of items, so "keep paging until we have `limit`
// items" isn't bounded on its own — a pathological site could make a
// cold request walk hundreds of pages before a CDN would ever protect
// it. 21 pages * 50 items/page = 1050, comfortably above
// MAX_LIMIT + 1 (the most we'd ever need to collect in one request).
const MAX_PAGES = 21

const EXCERPT_MAX = 200

function clampLimit(raw: number | undefined): number {
  const n = raw ?? DEFAULT_LIMIT
  // Reject NaN / +-Infinity outright (they'd otherwise survive the
  // min/max clamp below and reach AppSync's Int argument as-is) and
  // floor anything else so a fractional config value can't slip
  // through either.
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)))
}

// Resolves the effective limit, or `false` when the route is disabled.
function resolveLimit(ampless: Ampless): number | false {
  const cfg = ampless.cmsConfig.ai?.llmsTxt
  if (cfg === false) return false
  const raw = typeof cfg === 'object' && cfg !== null ? cfg.limit : undefined
  return clampLimit(raw)
}

// Collapse newlines / control characters (and the whitespace runs they
// leave behind) into single spaces. Applied to every piece of text
// that lands in the output — title, excerpt, tags, site name /
// description — so a value with embedded newlines can't break the
// one-entry-per-line list format.
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g

function normalizeText(s: string): string {
  return s
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// `]` closes a markdown link's text span and `[` opens a new one — a
// backslash escape (`\]`) isn't honoured by every parser, so link text
// uses HTML entities instead.
function escapeLinkText(s: string): string {
  return s.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
}

function truncateExcerpt(s: string): string {
  return s.length > EXCERPT_MAX ? s.slice(0, EXCERPT_MAX) + '…' : s
}

// MDN's fixedEncodeURIComponent: `encodeURIComponent` leaves
// `! ' ( ) *` unescaped (valid in a URI per RFC 3986, but `(` / `)`
// would prematurely close a markdown link's `(...)` if left bare).
function fixedEncodeURIComponent(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

type Truncation = 'limit' | 'early' | null

interface CollectResult {
  items: Post[]
  truncated: Truncation
}

/**
 * Walk `listPublishedPosts` pages via the shared `collectBounded` helper
 * (`ampless` core), bounded to `MAX_PAGES` pages of `PAGE_SIZE_CAP`
 * items each. `clampLimit` above guarantees `limit` is already a finite
 * positive integer, so it satisfies `collectBounded`'s argument
 * contract without any further coercion here.
 */
async function collectPosts(ampless: Ampless, limit: number): Promise<CollectResult> {
  return collectBounded<Post>(
    (args) => ampless.listPublishedPosts({ limit: args.limit, nextToken: args.nextToken }),
    { limit, pageSizeCap: PAGE_SIZE_CAP, maxPages: MAX_PAGES },
  )
}

// Both notes live in the description area, before the first `## Posts`
// heading — the llms.txt convention treats everything under an `## `
// heading as a link list, so a trailing paragraph after the list would
// confuse a naive parser.
function truncationNote(truncated: Truncation, limit: number): string | null {
  if (truncated === 'limit') {
    return `Note: only the ${limit} most recent posts are listed; older posts are omitted.`
  }
  if (truncated === 'early') {
    return (
      'Note: this index was truncated early while scanning the post list; ' +
      'some older posts may be missing. Lower ai.llmsTxt.limit or reduce post sizes.'
    )
  }
  return null
}

/**
 * `ai.llmsTxt: false` disables the route (404). Note that `llms.txt`
 * is always a reserved slug (`middleware.ts` `RESERVED_PREFIXES`)
 * regardless of that flag — a post whose slug happens to be
 * `llms.txt` can never reach the themed route.
 */
export function createLlmsTxtRouteHandler(ampless: Ampless): LlmsTxtRouteHandler {
  return async function GET(request: Request): Promise<Response> {
    // `ai.llmsTxt: false` disables the route entirely — checked before
    // the query-string redirect below so `llmsTxt: false` + a junk
    // query still 404s (the contract is "disabled means 404 for the
    // whole route"), not a 308 pointing at a route that itself 404s.
    const limit = resolveLimit(ampless)
    if (limit === false) {
      return new Response('Not Found', { status: 404 })
    }

    // Amplify's managed cache policy keys the CDN cache on the full
    // query string, so an arbitrary `?x=<random>` would otherwise
    // bypass the cache and trigger a fresh (up to `MAX_PAGES`-page)
    // AppSync walk per request. `/llms.txt` never takes query
    // parameters, so redirect to the bare path before touching the
    // database — the redirect itself is cacheable, so repeat hits with
    // the same junk query still cost only one redirect.
    const url = new URL(request.url)
    if (url.search) {
      return new Response(null, {
        status: 308,
        headers: {
          Location: url.pathname,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    const [{ items, truncated }, settings] = await Promise.all([
      collectPosts(ampless, limit),
      ampless.loadSiteSettings(),
    ])

    const markdownRoutesEnabled = ampless.cmsConfig.ai?.markdownRoutes !== false
    const siteUrl = (settings.site.url || '').replace(/\/+$/, '')
    const buildUrl = (path: string): string => (siteUrl ? `${siteUrl}${path}` : path)

    const blocks: string[] = [`# ${normalizeText(settings.site.name)}`]
    if (settings.site.description) {
      blocks.push(`> ${normalizeText(settings.site.description)}`)
    }
    if (markdownRoutesEnabled) {
      blocks.push(
        'Each entry links to the markdown projection of the post; drop the ' +
          '`.md` suffix for the themed HTML page.'
      )
    }
    const note = truncationNote(truncated, limit)
    if (note) blocks.push(note)
    if (ampless.cmsConfig.ai?.publicMcp === true) {
      // Shared with admin's MCP tokens card via `resolvePublicMcpEndpoint`
      // (ampless core) — both surfaces need the same origin-based
      // normalization and http(s)-only validation, so the endpoint they
      // advertise for a given `site.url` never disagrees. Falls back to a
      // relative path when the endpoint can't be resolved (missing /
      // non-http(s) `site.url`): llms.txt is always fetched from the same
      // site, so a relative link is still correct there even when an
      // absolute one isn't resolvable.
      const resolvedMcpUrl = resolvePublicMcpEndpoint(true, settings.site.url)
      const mcpUrl = typeof resolvedMcpUrl === 'string' ? resolvedMcpUrl : '/api/mcp'
      blocks.push(
        `This site also exposes a read-only MCP endpoint at ${mcpUrl} ` +
          '(JSON-RPC over HTTP POST; tools: list_posts, get_post, search_posts, list_tags; ' +
          'published posts only).'
      )
    }

    if (items.length > 0) {
      const lines = items.map((post) => {
        const encodedSlug = fixedEncodeURIComponent(post.slug)
        const href = markdownRoutesEnabled
          ? buildUrl(`/${encodedSlug}.md`)
          : buildUrl(`/${encodedSlug}`)
        const title = escapeLinkText(normalizeText(post.title))
        const excerpt = post.excerpt ? truncateExcerpt(normalizeText(post.excerpt)) : ''
        const tags = (post.tags ?? []).map((t) => normalizeText(t)).filter(Boolean)

        // The description separator (`: `) must lead whenever there's
        // any description content — excerpt, tags, or both — so a
        // tags-only entry doesn't read as `[title](url) (tags: ...)`
        // (no `:`, which llmstxt.org readers parse as "no description").
        let line = `- [${title}](${href})`
        if (excerpt && tags.length > 0) {
          line += `: ${excerpt} (tags: ${tags.join(', ')})`
        } else if (excerpt) {
          line += `: ${excerpt}`
        } else if (tags.length > 0) {
          line += `: (tags: ${tags.join(', ')})`
        }
        return line
      })
      blocks.push(`## Posts\n\n${lines.join('\n')}`)
    }

    const body = blocks.join('\n\n') + '\n'
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        // Self-computed: this route isn't reached via a middleware
        // rewrite, so nothing else would set Cache-Control (see the
        // header comment / og.ts for the same pattern). CDN-cacheable
        // for an hour so repeated crawler hits don't each cost a fresh
        // paginated AppSync walk.
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=3600',
      },
    })
  }
}
