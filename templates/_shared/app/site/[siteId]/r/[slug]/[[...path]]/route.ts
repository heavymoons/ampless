import { ampless } from '@/lib/ampless'
import { createUnderscoreRouteHandler } from '@ampless/runtime/routes'

// Unified handler for the public `/_/<slug>(/...)` URL family.
// Covers two cases that both bypass the theme's post page:
//
//  - `format: 'html'` posts with `metadata.no_layout === true`
//    → bare HTML response, no Next.js root layout, no theme chrome
//  - `format: 'static'` posts
//    → S3 presigned URL redirect for the entrypoint and every bundle file
//
// File location uses the literal folder name `r/` (not `_/`) because
// Next.js's App Router excludes any path part starting with `_` from
// route discovery. The middleware rewrites the public `/_/` prefix
// to `/r/` internally; the browser URL stays `/_/<slug>(/...)`.
export const dynamic = 'force-dynamic'
export const GET = createUnderscoreRouteHandler(ampless)
