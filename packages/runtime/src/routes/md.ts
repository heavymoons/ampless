import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ slug: string }>
}

export type MarkdownRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Route handler serving the per-post Markdown projection
 * (`ampless.postToMarkdown()`) for published posts of any format.
 *
 * Mounted at `app/md/[slug]/route.ts`; reached via middleware rewrite
 * of `/<slug>.md` → `/md/<slug>` internally — the public/canonical URL
 * is `/<slug>.md`. Middleware adds `md` to its reserved-prefix list so
 * a user post with slug `md` passes through to a 404 rather than
 * reaching this handler with the wrong content.
 *
 * Cache-Control: deliberately omitted from the response. Middleware
 * computes the strategy from `post.metadata.cache` + `post.updatedAt`
 * and sets the header on the rewritten response.
 */
export function createMarkdownRouteHandler(ampless: Ampless): MarkdownRouteHandler {
  return async function GET(_request: Request, { params }: Ctx): Promise<Response> {
    const { slug } = await params
    // Defensive: normalize a direct `/md/<slug>.md` hit the same way
    // middleware's rewrite target is named (bare slug, no extension).
    const cleanSlug = slug.replace(/\.md$/, '')
    if (ampless.cmsConfig.ai?.markdownRoutes === false) {
      return new Response('Not Found', { status: 404 })
    }
    const post = await ampless.getPublishedPost(cleanSlug)
    if (!post) {
      return new Response('Not Found', { status: 404 })
    }
    return new Response(await ampless.postToMarkdown(post), {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        // Cache-Control set by middleware.
      },
    })
  }
}
