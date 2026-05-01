import { getPublishedPost } from '@/lib/posts-public'
import { renderBody } from '@/lib/posts'

interface Ctx {
  params: Promise<{ siteId: string; slug: string }>
}

export const dynamic = 'force-dynamic'

/**
 * Bare HTML route. Returns the published post's rendered body as the
 * entire HTTP response — no Next.js root layout, no theme chrome.
 *
 * Reached via the slug-suffix convention: middleware rewrites
 * `/<slug>.html` → `/site/<siteId>/raw/<slug>.html`. The post is
 * looked up by the full slug (including the `.html` part), so what
 * the admin types in the slug field IS the URL.
 *
 * Why this is a route handler (not a page): Next.js's root layout
 * always emits `<html>` / `<head>` / `<body>`, which means a normal
 * page can't replace the document. A `route.ts` returns a Response
 * directly and bypasses React rendering entirely.
 *
 * Format pairing:
 *   - `format: 'html'` with a full `<!DOCTYPE html>...</html>` body
 *     → the body lands in the response unchanged. Best fit for
 *     custom landing pages with their own `<head>`, styles, scripts.
 *   - `format: 'tiptap'` / `'markdown'` → renderBody returns an
 *     HTML fragment. Browsers render fragments fine, but the page
 *     ships without `<!DOCTYPE>` / `<head>` / `<title>`. If you care
 *     about those, use `format: 'html'`.
 *
 * Trust model: the response body is the editor's content verbatim,
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
  return new Response(renderBody(post), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
