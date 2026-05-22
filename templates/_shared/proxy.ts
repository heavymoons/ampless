// Public-site proxy (Next.js 16 rename of "middleware"). Implementation
// moved to `@ampless/runtime` (L1 extraction); this file wires the
// project's `cms.config` into the factory and re-exports the default
// matcher. The runtime export name is still `createAmplessMiddleware`
// for API stability; only the user-side file convention (proxy.ts +
// `export const proxy`) follows Next 16's rename.
//
// See `@ampless/runtime/middleware` for behaviour details:
// `/path` → `/site/default/path` rewrite, `?previewTheme=` header
// forwarding.

import cmsConfig from './cms.config'
import { createAmplessMiddleware } from '@ampless/runtime/middleware'

export const proxy = createAmplessMiddleware({ cmsConfig })

// Next.js 16's Turbopack requires `config` to be a statically
// analysable object literal — referencing an imported variable
// (e.g. `defaultMatcherConfig` from @ampless/runtime/middleware)
// causes a build error:
//   "Next.js can't recognize the exported `config` field in route.
//    It needs to be a static object."
//
// So we inline the matcher here. If you change it, keep it in sync
// with `defaultMatcherConfig` documented in @ampless/runtime/middleware.
// The matcher excludes admin / api / login / static assets /
// amplify_outputs.json so the public-site proxy doesn't rewrite
// legitimate non-blog routes.
export const config = {
  matcher: [
    '/((?!admin|api|login|_next/static|_next/image|favicon\\.ico|amplify_outputs\\.json).*)',
  ],
}
