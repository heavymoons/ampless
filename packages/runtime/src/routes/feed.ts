import type { Ampless } from '../index.js'

// File route is `app/feed.xml/route.ts` — no dynamic segments.
interface Ctx {
  params: Promise<Record<string, never>>
}

export type FeedRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Feed route delegate. Looks up the active theme and forwards to
 * whichever `routes.feed` handler the theme provides. Themes without
 * a feed handler return 404.
 */
export function createFeedRouteHandler(ampless: Ampless): FeedRouteHandler {
  return async function GET(request: Request): Promise<Response> {
    const { module } = await ampless.resolveActiveTheme()
    const handler = module.routes?.feed
    if (!handler) {
      return new Response('feed not implemented for this theme', { status: 404 })
    }
    return handler({ request })
  }
}
