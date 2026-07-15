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
    // No defensive `.md` stripping here: `/md/` is an internal rewrite
    // target, not a public URL a crawler can hit with an arbitrary
    // suffix. Middleware (`middleware.ts` `isMdRequest`) has already
    // stripped exactly one trailing `.md` from the public `/<slug>.md`
    // URL before computing `lookupSlug`, so `slug` here is already the
    // exact stored slug. Stripping again would break posts whose slug
    // itself ends in `.md` (slug `foo.md` → public URL `/foo.md.md` →
    // middleware strips one `.md` → this handler receives `foo.md`,
    // which must be looked up as-is). This differs from `og.ts`'s
    // `.png` strip, which defends a public URL that crawlers hit
    // directly with extensions of their own choosing.
    if (ampless.cmsConfig.ai?.markdownRoutes === false) {
      return new Response('Not Found', { status: 404 })
    }
    const post = await ampless.getPublishedPost(slug)
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
