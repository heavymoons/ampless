import { NextResponse, type NextRequest } from 'next/server'
import { resolveSiteId, isMultiSite, type Config } from 'ampless'

export interface CreateMiddlewareOpts {
  cmsConfig: Config
}

export type MiddlewareFn = (request: NextRequest) => NextResponse

/**
 * Build the ampless public-site middleware. Performs:
 *
 *  - hostname → siteId resolution (multi-site rewrites)
 *  - `/path` → `/site/<siteId>/path` internal rewrite
 *  - `/_/<slug>(/...)` → `/site/<siteId>/r/<slug>(/...)` rewrite for
 *    the unified bare-HTML / static-bundle route
 *  - `?previewTheme=<name>` → `x-preview-theme` header forwarding
 *  - `Cache-Control: private, no-store` in multi-site mode (Amplify
 *    Hosting's CloudFront cache key doesn't include Host, so SSR
 *    responses would cross-contaminate at the same path)
 *
 * Bare-HTML / static routing is data-driven: the theme post dispatcher
 * redirects `metadata.no_layout` and `format='static'` posts to
 * `/_/<slug>`. The middleware rewrites the public `_` prefix to the
 * routable internal folder name `r/`, because Next.js's App Router
 * excludes any path part starting with `_` during route discovery
 * (see `recursive-readdir` + `ignorePartFilter` in
 * `next/dist/build/route-discovery.js`). The browser URL stays
 * `/_/<slug>(/...)`; only the rewrite target uses `r/`.
 *
 * The factory captures the multi-site flag at construction time so the
 * hot path stays a pair of cheap header lookups.
 */
export function createAmplessMiddleware({ cmsConfig }: CreateMiddlewareOpts): MiddlewareFn {
  const MULTI_SITE = isMultiSite(cmsConfig)

  // Public path → /site/{siteId}/... internal rewrite. The browser URL
  // stays unchanged; Next.js resolves the rewritten path under
  // `app/site/[siteId]/...`.
  //
  // (We use `/site/` rather than `/_sites/` because Next.js treats
  // folders with an underscore prefix as private — they're not routable
  // even via middleware rewrites. The unified `_` route gets the same
  // treatment via the `_ → r` translation below.)
  //
  // In multi-site mode we additionally force `Cache-Control: private,
  // no-store` because Amplify Hosting's CloudFront cache key doesn't
  // include Host — caching SSR responses there would let site1 and
  // site2 cross-contaminate at the same path.
  return function middleware(request: NextRequest): NextResponse {
    const host = (request.headers.get('host') ?? '').split(':')[0]
    const siteId = resolveSiteId(host ?? '', cmsConfig)
    if (!siteId) {
      return new NextResponse('Site not found', { status: 404 })
    }

    const url = request.nextUrl.clone()
    if (!url.pathname.startsWith('/site/')) {
      let tail = url.pathname === '/' ? '' : url.pathname
      // Public `_` namespace → routable internal folder `r`. The
      // App Router won't discover folders starting with `_`, so the
      // rewrite target must use a non-underscore name. Single literal
      // `_` segment only; nested underscore-prefixed slugs are left
      // alone (none of the reserved routes have them).
      if (tail === '/_' || tail.startsWith('/_/')) {
        tail = `/r${tail.slice(2)}`
      }
      url.pathname = `/site/${siteId}${tail}`
    }

    // Theme preview override. The admin's iframe-based preview hits
    // `/?previewTheme=<name>&previewColorScheme=<auto|light|dark>` to
    // show an unsaved theme + color-scheme combination. Both query
    // params get forwarded into request headers so server components
    // (`resolveActiveTheme`, the root layout) can read them via
    // `headers()` regardless of which page handles the request.
    const previewTheme = url.searchParams.get('previewTheme')
    const previewColorScheme = url.searchParams.get('previewColorScheme')
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-site-id', siteId)
    if (previewTheme) requestHeaders.set('x-preview-theme', previewTheme)
    if (previewColorScheme) requestHeaders.set('x-preview-color-scheme', previewColorScheme)

    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    response.headers.set('x-site-id', siteId)
    if (MULTI_SITE) {
      response.headers.set('Cache-Control', 'private, no-store')
    }
    return response
  }
}

/**
 * Reference matcher config — admin / api / login / static assets /
 * amplify_outputs.json are excluded so middleware doesn't rewrite
 * legitimate non-blog routes into the public site tree.
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
