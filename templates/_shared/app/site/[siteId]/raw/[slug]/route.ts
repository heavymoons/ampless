import { getPublishedPost } from '@/lib/posts-public'

interface Ctx {
  params: Promise<{ siteId: string; slug: string }>
}

export const dynamic = 'force-dynamic'

/**
 * Bare HTML route. Returns a published post's body as the entire
 * HTTP response, with no theme chrome and no Next.js layout wrapping
 * — the post is expected to ship a full `<!DOCTYPE html>...` document.
 *
 * Why this is a route handler (not a page): the root layout always
 * emits `<html>` / `<head>` / `<body>`, which means a normal page
 * can't replace the document. A `route.ts` returns a Response
 * directly and bypasses React rendering entirely.
 *
 * Use cases: marketing splash pages, one-off landing flows with
 * tracking pixels in `<head>`, anything that needs full control of
 * the document.
 *
 * Reachable at `/raw/<slug>` — middleware rewrites that path into
 * `/site/<siteId>/raw/<slug>` like any other public URL. Posts at
 * regular `/<slug>` keep going through the theme.
 *
 * Trust model: the returned HTML is the editor's content verbatim,
 * with no sanitization. Same trust assumption as `format: 'html'`
 * post bodies on the regular path — see
 * docs/architecture/04-access-layer-mcp.md §"editor の信頼モデル".
 */
export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const { siteId, slug } = await params
  const post = await getPublishedPost(slug, { siteId })
  if (!post) {
    return new Response('Not Found', { status: 404 })
  }
  if (post.format !== 'html') {
    return new Response(
      `This post is not in HTML format. /raw/<slug> requires format: 'html'.`,
      { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    )
  }
  const body = typeof post.body === 'string' ? post.body : String(post.body ?? '')
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
