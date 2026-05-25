import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ slug: string }>
}

export type RawRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Internal route handler for `format: 'html'` posts whose
 * `metadata.no_layout === true` — the body is its own complete HTML
 * document and ships as the entire response (no Next.js root layout,
 * no theme chrome).
 *
 * Mounted at `app/raw/[slug]/route.ts`; reached via middleware rewrite
 * of `/<slug>` → `/raw/<slug>`. Never hit directly — middleware adds
 * `raw` to its reserved-prefix list so a user post with slug `raw`
 * passes through to a 404 rather than reaching this handler with the
 * wrong content.
 *
 * Trust model: the body is emitted verbatim, same trust shape as
 * regular `format: 'html'` posts on the themed route. See
 * docs/architecture/04-access-layer-mcp.md §"editor の信頼モデル".
 *
 * Cache-Control: deliberately omitted from the response. Middleware
 * computes the strategy from `post.metadata.cache` + `post.updatedAt`
 * and sets the header on the rewritten response.
 */
export function createRawRouteHandler(ampless: Ampless): RawRouteHandler {
  return async function GET(_request: Request, { params }: Ctx): Promise<Response> {
    const { slug } = await params
    const post = await ampless.getPublishedPost(slug)
    if (!post) {
      return new Response('Not Found', { status: 404 })
    }
    // Defensive: any post arriving here that isn't no_layout HTML is a
    // middleware bug — those slugs should never be rewritten to /raw/.
    // 404 instead of leaking a chrome-free body.
    if (post.format !== 'html' || post.metadata?.no_layout !== true) {
      return new Response('Not Found', { status: 404 })
    }
    return new Response(ampless.renderBody(post), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Cache-Control set by middleware.
      },
    })
  }
}
