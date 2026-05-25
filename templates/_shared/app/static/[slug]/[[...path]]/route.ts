import { ampless } from '@/lib/ampless'
import { createStaticRouteHandler } from '@ampless/runtime/routes'

// Internal handler for `format: 'static'` posts — the body is a
// manifest pointing at a bundle of files in S3 at
// `public/static/<slug>/`. Reached via middleware rewrite from
// `/<slug>(/<path>)` — never directly. Each request becomes a short-
// lived S3 presigned redirect (302) for the entrypoint or the
// requested bundle file. The browser URL stays `/<slug>(/<path>)`;
// the `/static/` prefix is an implementation detail (folder names
// starting with `_` are excluded by the App Router, hence the
// explicit `static/`).
export const dynamic = 'force-dynamic'
export const GET = createStaticRouteHandler(ampless)
