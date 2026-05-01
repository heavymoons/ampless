import { NextResponse, type NextRequest } from 'next/server'
import { resolveSiteId, isMultiSite } from 'ampless'
import cmsConfig from './cms.config'

const MULTI_SITE = isMultiSite(cmsConfig)

// Public path → /_sites/{siteId}/... rewrite. Admin / API / login /
// static files are excluded by the matcher below, so this only
// touches the public blog surface.
//
// In multi-site mode we additionally force `Cache-Control: private,
// no-store` because Amplify Hosting's CloudFront cache key doesn't
// include Host — caching SSR responses there would let site1 and
// site2 cross-contaminate at the same path.
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0]
  const siteId = resolveSiteId(host, cmsConfig)
  if (!siteId) {
    return new NextResponse('Site not found', { status: 404 })
  }

  const url = request.nextUrl.clone()
  if (!url.pathname.startsWith('/_sites/')) {
    const tail = url.pathname === '/' ? '' : url.pathname
    url.pathname = `/_sites/${siteId}${tail}`
  }

  const response = NextResponse.rewrite(url)
  response.headers.set('x-site-id', siteId)
  if (MULTI_SITE) {
    response.headers.set('Cache-Control', 'private, no-store')
  }
  return response
}

export const config = {
  matcher: [
    // Match all paths *except* admin, api, login, static assets, and
    // amplify_outputs.json. Without these exclusions middleware would
    // rewrite legitimate non-blog routes into the public site tree.
    '/((?!admin|api|login|_next/static|_next/image|favicon\\.ico|amplify_outputs\\.json).*)',
  ],
}
