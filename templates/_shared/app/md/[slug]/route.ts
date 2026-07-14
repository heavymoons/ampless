import { ampless } from '@/lib/ampless'
import { createMarkdownRouteHandler } from '@ampless/runtime/routes'

// Markdown projection for published posts (any format). Reached via
// middleware rewrite from `/<slug>.md` — never directly. The browser
// URL stays `/<slug>.md`; the `/md/` prefix is an implementation
// detail (folder names starting with `_` are excluded by the App
// Router, hence the explicit `md/`).
export const dynamic = 'force-dynamic'
export const GET = createMarkdownRouteHandler(ampless)
