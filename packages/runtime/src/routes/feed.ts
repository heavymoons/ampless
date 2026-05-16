import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ siteId: string }>
}

export type FeedRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Feed route delegate. Looks up the active theme for the request's
 * siteId and forwards to whichever `routes.feed` handler the theme
 * provides. Themes without a feed handler return 404.
 */
export function createFeedRouteHandler(ampless: Ampless): FeedRouteHandler {
  return async function GET(request: Request, { params }: Ctx): Promise<Response> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const handler = module.routes?.feed
    if (!handler) {
      return new Response('feed not implemented for this theme', { status: 404 })
    }
    return handler({ siteId, request })
  }
}
