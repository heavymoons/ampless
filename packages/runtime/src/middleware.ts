import { NextResponse, type NextRequest } from 'next/server'
import { resolveSiteId, isMultiSite, type Config } from 'ampless'

export interface CreateMiddlewareOpts {
  cmsConfig: Config
}

export type MiddlewareFn = (request: NextRequest) => NextResponse

// Slug-suffix convention for bare HTML pages. A request to a single
// path segment ending in `.html` (e.g. `/promo.html`) is rewritten to
// the layout-less route handler under `/site/<siteId>/raw/<slug>`,
// which returns the post body as a `text/html` response without any
// theme chrome or Next.js root layout. The browser URL stays as-is.
//
// Conventional and zero-infrastructure: middleware doesn't need to
// know per-post format. The route handler at /raw/<slug> looks up the
// post and returns whatever `renderBody` produces. If the post is in
// `format: 'html'` with a complete `<!DOCTYPE html>...</html>` body,
// it lands in the response unchanged. Tiptap / markdown posts with a
// `.html` slug will render as HTML fragments — works but the author
// is on their own for missing `<head>` etc.
const RAW_HTML_PATH_RE = /^\/([^/]+\.html)$/

/**
 * Build the ampless public-site middleware. Performs:
 *
 *  - hostname → siteId resolution (multi-site rewrites)
 *  - `/path` → `/site/<siteId>/path` internal rewrite
 *  - `<slug>.html` → `/site/<siteId>/raw/<slug>.html` (bare HTML route)
 *  - `?previewTheme=<name>` → `x-preview-theme` header forwarding
 *  - `Cache-Control: private, no-store` in multi-site mode (Amplify
 *    Hosting's CloudFront cache key doesn't include Host, so SSR
 *    responses would cross-contaminate at the same path)
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
  // even via middleware rewrites.)
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
      const rawMatch = RAW_HTML_PATH_RE.exec(url.pathname)
      if (rawMatch) {
        url.pathname = `/site/${siteId}/raw/${rawMatch[1]}`
      } else {
        const tail = url.pathname === '/' ? '' : url.pathname
        url.pathname = `/site/${siteId}${tail}`
      }
    }

    // Theme preview override. The admin's iframe-based preview hits
    // `/?previewTheme=<name>` to show a different theme without
    // committing the switch. We forward the query param into a request
    // header so server components / `resolveActiveTheme` can pick it
    // up via `headers()` regardless of which page handles the request.
    const previewTheme = url.searchParams.get('previewTheme')
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-site-id', siteId)
    if (previewTheme) requestHeaders.set('x-preview-theme', previewTheme)

    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    response.headers.set('x-site-id', siteId)
    if (MULTI_SITE) {
      response.headers.set('Cache-Control', 'private, no-store')
    }
    return response
  }
}

/**
 * Default Next.js middleware matcher config. Exposed as a constant so
 * templates can re-export it directly:
 *
 *     export const config = defaultMatcherConfig
 *
 * Excludes admin / api / login / static assets / amplify_outputs.json
 * — without these exclusions middleware would rewrite legitimate
 * non-blog routes into the public site tree.
 */
export const defaultMatcherConfig = {
  matcher: [
    '/((?!admin|api|login|_next/static|_next/image|favicon\\.ico|amplify_outputs\\.json).*)',
  ],
}
