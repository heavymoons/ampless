import { ampless } from '@/lib/ampless'
import { createStaticRouteHandler } from '@ampless/runtime/routes'

// Catch-all handler for `format: 'static'` post bundles. Lives here
// instead of under a dedicated `/static/` prefix so the published URL
// stays a clean `/<slug>/…`, matching how a developer would host a
// hand-written landing page locally. The runtime handler enforces
// `format === 'static'` and 404s for any other post format reaching
// this route.
//
// Routing precedence: Next.js prefers the more specific
// `[siteId]/[slug]/page.tsx` for single-segment URLs, so the regular
// theme post dispatcher keeps handling normal posts. This catch-all
// only fires for multi-segment requests (e.g. `/promo/index.html`,
// `/promo/assets/style.css`).
export const dynamic = 'force-dynamic'
export const GET = createStaticRouteHandler(ampless)
