import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ siteId: string }>
}

export type SitemapRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Sitemap route delegate. Looks up the active theme for the request's
 * siteId and forwards to whichever `routes.sitemap` handler the theme
 * provides. Themes without a sitemap handler return 404.
 */
export function createSitemapRouteHandler(ampless: Ampless): SitemapRouteHandler {
  return async function GET(request: Request, { params }: Ctx): Promise<Response> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const handler = module.routes?.sitemap
    if (!handler) {
      return new Response('sitemap not implemented for this theme', { status: 404 })
    }
    return handler({ siteId, request })
  }
}
