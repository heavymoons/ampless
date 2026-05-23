// Middleware-driven post routing.
//
// Public URL surface (after v0.2 alpha URL flatten):
//   /                     — home (themed, no rewrite)
//   /<slug>               — themed post (default), no_layout HTML, or
//                           static-bundle entrypoint, depending on
//                           the post's `format` / `metadata.no_layout`
//   /<slug>/<path>        — static-bundle internal file
//   /feed.xml, /sitemap.xml, /og/<slug>, /tag/<tag>
//                         — direct route handlers (no rewrite)
//
// All routing decisions happen here. Middleware fetches a tiny
// `{ format, metadata, updatedAt }` projection from AppSync per slug,
// caches it in module scope (Lambda warm cache), and rewrites to the
// appropriate internal handler:
//
//   themed                → no rewrite, served by app/[slug]/page.tsx
//   no_layout HTML / static → /r/<slug>(/<path>), served by the unified
//                             route handler at app/r/[slug]/[[...path]]/route.ts
//
// The `r/` segment is a Next.js implementation detail — the literal
// folder is `r/` not `_/` because the App Router skips any path part
// starting with `_` during route discovery. The browser URL stays
// `/<slug>(/<path>)` throughout.
//
// Cache-Control is computed from `post.metadata.cache` (auto/deep/hot)
// + `post.updatedAt` + `cms.config.cache.*` and set on the response.
// Routes themselves do not set Cache-Control on the request paths
// covered here.

import { NextResponse, type NextRequest } from 'next/server'
import type { CacheConfig, Config, PostMetadata } from 'ampless'

// Node.js runtime required: module-scope state (the LRU below) only
// persists across requests on Node lambdas, not Edge.
export const runtime = 'nodejs'

export interface CreateMiddlewareOpts {
  cmsConfig: Config
  /** AppSync GraphQL endpoint URL (from `amplify_outputs.json` `data.url`). */
  appsyncUrl: string
  /** Public API key for the AppSync endpoint (from `amplify_outputs.json` `data.api_key`). */
  apiKey: string
}

export type MiddlewareFn = (request: NextRequest) => Promise<NextResponse>

interface PostFlags {
  format: 'tiptap' | 'markdown' | 'html' | 'static'
  metadata: PostMetadata | null
  /** ISO 8601 — possibly empty string if the schema field is missing. */
  updatedAt: string
}

// In-memory LRU. Lambdas reuse module scope across warm invocations, so
// hot slugs cost zero AppSync queries for the duration of the TTL.
// Sized to match a typical homepage's first paint (top N posts) without
// growing unboundedly under traffic spikes.
const FLAG_CACHE_MAX = 200
const FLAG_CACHE_TTL_MS = 60_000
const FLAG_CACHE = new Map<string, { value: PostFlags | null; expires: number }>()

function cacheGet(slug: string): PostFlags | null | undefined {
  const hit = FLAG_CACHE.get(slug)
  if (!hit) return undefined
  if (hit.expires < Date.now()) {
    FLAG_CACHE.delete(slug)
    return undefined
  }
  // Touch for LRU ordering — re-insertion moves the key to the tail
  // of Map iteration, so `keys().next()` always returns the oldest.
  FLAG_CACHE.delete(slug)
  FLAG_CACHE.set(slug, hit)
  return hit.value
}

function cacheSet(slug: string, value: PostFlags | null): void {
  if (FLAG_CACHE.size >= FLAG_CACHE_MAX) {
    const oldest = FLAG_CACHE.keys().next().value
    if (oldest !== undefined) FLAG_CACHE.delete(oldest)
  }
  FLAG_CACHE.set(slug, { value, expires: Date.now() + FLAG_CACHE_TTL_MS })
}

// Exported for tests. Production code should never need to call this
// directly — module-scope state is intentionally process-local.
export function _resetFlagCache(): void {
  FLAG_CACHE.clear()
}

async function fetchFlags(
  opts: CreateMiddlewareOpts,
  slug: string,
): Promise<PostFlags | null> {
  // Minimal projection: only the three fields routing + cache need.
  // Keep this query stable across schema additions so the flag fetch
  // stays a small, predictable cost.
  const query = `query MiddlewareFlags($slug: String!) {
    getPublishedPost(slug: $slug) { format metadata updatedAt }
  }`
  let res: Response
  try {
    res = await fetch(opts.appsyncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
      },
      body: JSON.stringify({ query, variables: { slug } }),
    })
  } catch (err) {
    // Network failures bubble up to the caller as null so the request
    // falls through to the themed route (which itself returns 404 when
    // the post can't be fetched). Logging matters because middleware
    // failures otherwise vanish silently.
    console.error('[ampless-middleware] AppSync fetch failed', err)
    return null
  }
  if (!res.ok) {
    console.error(
      `[ampless-middleware] AppSync returned ${res.status} for slug=${slug}`,
    )
    return null
  }
  let body: {
    data?: {
      getPublishedPost: {
        format?: string | null
        metadata?: string | null
        updatedAt?: string | null
      } | null
    }
    errors?: Array<{ message?: string }>
  }
  try {
    body = (await res.json()) as typeof body
  } catch (err) {
    console.error('[ampless-middleware] AppSync JSON parse failed', err)
    return null
  }
  if (body.errors && body.errors.length > 0) {
    console.error(
      '[ampless-middleware] AppSync errors',
      body.errors.map((e) => e.message),
    )
    return null
  }
  const post = body.data?.getPublishedPost
  if (!post) return null
  let metadata: PostMetadata | null = null
  // metadata is AWSJSON-encoded (a JSON string) over the wire when
  // surfaced from `a.json()`. Decode defensively — malformed payloads
  // shouldn't crash routing.
  if (post.metadata) {
    try {
      const parsed = typeof post.metadata === 'string'
        ? JSON.parse(post.metadata)
        : post.metadata
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as PostMetadata
      }
    } catch (err) {
      console.error(
        `[ampless-middleware] metadata parse failed for slug=${slug}`,
        err,
      )
      metadata = null
    }
  }
  return {
    format: (post.format ?? 'markdown') as PostFlags['format'],
    metadata,
    updatedAt: post.updatedAt ?? '',
  }
}

async function getCachedFlags(
  opts: CreateMiddlewareOpts,
  slug: string,
): Promise<PostFlags | null> {
  const cached = cacheGet(slug)
  if (cached !== undefined) return cached
  const fresh = await fetchFlags(opts, slug)
  cacheSet(slug, fresh)
  return fresh
}

// Defaults match the documented `CacheConfig` fields.
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour
const DEFAULT_FRESH_TTL_SECONDS = 300 // 5 minutes
const DEFAULT_DEEP_TTL_SECONDS = 60 * 60 // 1 hour

const NO_STORE = 'public, max-age=0, must-revalidate, s-maxage=0'

/**
 * Compute the `Cache-Control` header for a post response. The
 * strategy lives on `post.metadata.cache`; absent (or 'auto') falls
 * back to cooldown-by-edit-time logic. See `CacheStrategy` /
 * `CacheConfig` in ampless types for the semantic contract.
 */
export function computeCacheControl(
  flags: { metadata: PostMetadata | null; updatedAt: string },
  cmsConfig: Config,
): string {
  const cache: CacheConfig = cmsConfig.cache ?? {}
  const strategy = flags.metadata?.cache ?? 'auto'
  if (strategy === 'hot') return NO_STORE
  if (strategy === 'deep') {
    const ttl = cache.deepTtlSeconds ?? DEFAULT_DEEP_TTL_SECONDS
    return `public, max-age=${ttl}, s-maxage=${ttl}`
  }
  // 'auto': cooldown by edit time. Missing/unparseable updatedAt is
  // treated as "very old" — emit the post-cooldown TTL.
  const cooldownMs = cache.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const freshTtl = cache.freshTtlSeconds ?? DEFAULT_FRESH_TTL_SECONDS
  const updatedMs = flags.updatedAt ? Date.parse(flags.updatedAt) : NaN
  if (Number.isFinite(updatedMs)) {
    const ageMs = Date.now() - updatedMs
    if (ageMs < cooldownMs) return NO_STORE
  }
  return `public, max-age=${freshTtl}, s-maxage=${freshTtl}`
}

// Reserved first-path-segments that middleware should never treat as a
// post slug. The matcher (`defaultMatcherConfig`) excludes most of
// these from invocation entirely; the runtime check is defence in
// depth in case the matcher is loosened downstream.
const RESERVED_PREFIXES = new Set<string>([
  'admin',
  'api',
  'login',
  '_next',
  'favicon.ico',
  'robots.txt',
  'amplify_outputs.json',
  // route handler folders that live alongside `app/[slug]/page.tsx`
  'feed.xml',
  'sitemap.xml',
  'og',
  'tag',
  // internal rewrite target — direct hits should not be middleware-driven
  'r',
])

/**
 * Build the ampless public-site middleware. Performs:
 *
 *  - AppSync flag fetch (`format` / `metadata` / `updatedAt`) per
 *    slug, with a 200-entry LRU keyed by slug, 60s TTL. Hot slugs
 *    cost zero queries for the cache lifetime.
 *  - Rewrite to `/r/<slug>(/<path>)` when the post is no_layout HTML
 *    (`format=html` + `metadata.no_layout=true`) or a static bundle
 *    (`format='static'`). Themed posts (default) get no rewrite —
 *    `app/[slug]/page.tsx` serves them directly.
 *  - `Cache-Control` header computed from `post.metadata.cache` +
 *    `post.updatedAt` + `cms.config.cache.*` and set on the response.
 *  - `?previewTheme` / `?previewColorScheme` → `x-preview-theme` /
 *    `x-preview-color-scheme` header forwarding for the admin's
 *    iframe-based theme preview.
 */
export function createAmplessMiddleware(opts: CreateMiddlewareOpts): MiddlewareFn {
  return async function middleware(request: NextRequest): Promise<NextResponse> {
    const url = request.nextUrl.clone()

    // Theme preview override. The admin's iframe-based preview hits
    // `/?previewTheme=<name>&previewColorScheme=<auto|light|dark>` to
    // show an unsaved theme + color-scheme combination. Both query
    // params get forwarded into request headers so server components
    // (`resolveActiveTheme`, the root layout) can read them via
    // `headers()` regardless of which page handles the request.
    const previewTheme = url.searchParams.get('previewTheme')
    const previewColorScheme = url.searchParams.get('previewColorScheme')
    const requestHeaders = new Headers(request.headers)
    if (previewTheme) requestHeaders.set('x-preview-theme', previewTheme)
    if (previewColorScheme) {
      requestHeaders.set('x-preview-color-scheme', previewColorScheme)
    }
    const passthrough = (): NextResponse =>
      NextResponse.next({ request: { headers: requestHeaders } })

    // Parse path. `/foo/bar` → ['foo', 'bar']; `/` → [].
    const segments = url.pathname.split('/').filter(Boolean)

    if (segments.length === 0) {
      // Root home — themed.
      return passthrough()
    }

    const slug = segments[0]!
    if (RESERVED_PREFIXES.has(slug)) {
      return passthrough()
    }
    const restPath = segments.slice(1)

    const flags = await getCachedFlags(opts, slug)

    if (!flags) {
      // Post not found. Multi-segment paths can only be static; bare
      // 404. Single-segment falls through to the themed route so its
      // own `notFound()` handles it (Next.js renders the not-found
      // UI rather than the default Response 404).
      if (restPath.length > 0) {
        return new NextResponse('Not Found', { status: 404 }) as NextResponse
      }
      return passthrough()
    }

    const cacheControl = computeCacheControl(flags, opts.cmsConfig)
    let response: NextResponse
    if (restPath.length === 0) {
      // Single-segment `/<slug>`. Three sub-cases:
      //   - no_layout HTML  → rewrite to /r/<slug>
      //   - static bundle   → rewrite to /r/<slug>
      //   - anything else   → themed render
      if (flags.format === 'html' && flags.metadata?.no_layout === true) {
        url.pathname = `/r/${slug}`
        response = NextResponse.rewrite(url, {
          request: { headers: requestHeaders },
        })
      } else if (flags.format === 'static') {
        url.pathname = `/r/${slug}`
        response = NextResponse.rewrite(url, {
          request: { headers: requestHeaders },
        })
      } else {
        response = passthrough()
      }
    } else {
      // Multi-segment `/<slug>/<path>`. Only static bundles are
      // legitimate here — themed posts have no sub-paths.
      if (flags.format === 'static') {
        url.pathname = `/r/${slug}/${restPath.join('/')}`
        response = NextResponse.rewrite(url, {
          request: { headers: requestHeaders },
        })
      } else {
        return new NextResponse('Not Found', { status: 404 }) as NextResponse
      }
    }

    response.headers.set('Cache-Control', cacheControl)
    return response
  }
}

/**
 * Reference matcher config — admin / api / login / static assets /
 * amplify_outputs.json are excluded so middleware doesn't rewrite
 * legitimate non-blog routes.
 *
 * **You can't re-export this directly.** Next.js 16's Turbopack
 * requires `export const config` in `proxy.ts` (or `middleware.ts`)
 * to be a statically analysable object literal — referencing an
 * imported variable fails the build with:
 *   "Next.js can't recognize the exported `config` field in route.
 *    It needs to be a static object."
 *
 * So the scaffold inlines the matcher into the user's `proxy.ts`.
 * This export is kept as a reference for documentation and for
 * non-Next.js callers that want to inspect the canonical matcher.
 */
export const defaultMatcherConfig = {
  matcher: [
    '/((?!admin|api|login|_next/static|_next/image|favicon\\.ico|amplify_outputs\\.json).*)',
  ],
}
