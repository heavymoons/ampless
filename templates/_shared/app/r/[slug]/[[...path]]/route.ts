import { ampless } from '@/lib/ampless'
import { createUnderscoreRouteHandler } from '@ampless/runtime/routes'

// Internal handler for no_layout HTML and static-bundle posts. Reached
// via middleware rewrite from `/<slug>(/<path>)` — never directly.
// Covers two cases that both bypass the themed post page:
//
//  - `format: 'html'` posts with `metadata.no_layout === true`
//    → bare HTML response, no Next.js root layout, no theme chrome
//  - `format: 'static'` posts
//    → S3 presigned URL redirect for the entrypoint and every bundle file
//
// The literal folder is `r/` (not `_/` etc.) because Next.js's App
// Router excludes any path part starting with `_` from route
// discovery. The browser URL stays `/<slug>(/<path>)` throughout —
// middleware does the public→internal translation.
export const dynamic = 'force-dynamic'
export const GET = createUnderscoreRouteHandler(ampless)
