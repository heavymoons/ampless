import { ampless } from '@/lib/ampless'
import { createRawRouteHandler } from '@ampless/runtime/routes'

// Internal handler for `format: 'html'` posts with
// `metadata.no_layout === true`. Reached via middleware rewrite from
// `/<slug>` — never directly. The browser URL stays `/<slug>`; the
// `/raw/` prefix is an implementation detail (folder names starting
// with `_` are excluded by the App Router, hence the explicit `raw/`).
export const dynamic = 'force-dynamic'
export const GET = createRawRouteHandler(ampless)
