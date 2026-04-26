import { NextResponse, type NextRequest } from 'next/server'

// Multi-site middleware: resolves siteId from hostname and injects as a request header.
// v0.1: single-site pass-through. Phase 4+ wires this to cms.config.ts sites mapping.
export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  response.headers.set('x-site-id', 'default')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
