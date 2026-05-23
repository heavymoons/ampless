import type { Ampless } from '../index.js'

// File route is `app/sitemap.xml/route.ts` — no dynamic segments.
interface Ctx {
  params: Promise<Record<string, never>>
}

export type SitemapRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Sitemap route delegate. Looks up the active theme and forwards to
 * whichever `routes.sitemap` handler the theme provides. Themes
 * without a sitemap handler return 404.
 */
export function createSitemapRouteHandler(ampless: Ampless): SitemapRouteHandler {
  return async function GET(request: Request): Promise<Response> {
    const { module } = await ampless.resolveActiveTheme()
    const handler = module.routes?.sitemap
    if (!handler) {
      return new Response('sitemap not implemented for this theme', { status: 404 })
    }
    return handler({ request })
  }
}
