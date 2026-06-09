import type { Post } from 'ampless'
import { admin } from '@/lib/admin'

/**
 * Preview-only Route Handler. Client-side `<PostForm>` / `<PostHistoryPanel>`
 * POST a draft Post to this endpoint while the preview tab is open; we
 * render the body + page-level scripts via `ampless.renderBody` /
 * `publicPostScriptsForPage` and return a fully-rendered HTML string
 * that the admin shows in an iframe (`sandbox="allow-scripts allow-same-origin"`,
 * v1 trust boundary expansion — admin preview content / plugin script are
 * explicitly treated as trusted; see the iframe comment in post-form.tsx).
 *
 * Why a Route Handler instead of a Server Action: Next.js 15+
 * refuses to compile Client Components that reach `react-dom/server`
 * through a `'use server'` module, because the build traces the
 * import graph from Client Components through Server Action modules.
 * Putting this rendering behind a Route Handler decouples it from
 * that graph entirely — the form fetches a plain HTTP endpoint and
 * the bundler never walks from `<PostForm>` into here. The endpoint
 * also gets an explicit `admin.isEditor()` gate so a future change
 * to the `(admin)` route-group middleware can't silently turn
 * preview into a content-leak vector for unpublished drafts.
 *
 * The `react-dom/server` import itself is loaded via dynamic
 * `import()` inside the handler. Next.js 16's Turbopack flags any
 * top-level static `import 'react-dom/server'` reached from the app
 * router build (Route Handlers included), so we deliberately defer
 * the resolution to request time — the module is still pulled from
 * the same Node.js subpath that `next start` ships, just not visible
 * to the build-time import-graph walker.
 *
 * Auth: locked to authenticated editors. Anonymous + reader access is
 * 403. This matches the rest of `/admin/**`, which is gated by the
 * `(admin)` route group + middleware, but we add an explicit check
 * here as defence-in-depth against the middleware gate being
 * misconfigured.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await admin.getServerSession()
  if (!admin.isEditor(session)) {
    return new Response('Forbidden', { status: 403 })
  }
  let draft: Post
  try {
    draft = (await req.json()) as Post
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const ampless = await admin.getAmpless()
  // IMPORTANT: include BOTH the body and the page-level scripts so
  // widgets like x.com's `widgets.js` get a chance to hydrate in the
  // iframe.
  const node = (
    <>
      {await ampless.renderBody(draft)}
      {await ampless.publicPostScriptsForPage([draft])}
    </>
  )
  // Dynamic import: see top-of-file comment. The module is server-only
  // and resolved at request time.
  const { renderToStaticMarkup } = await import('react-dom/server')
  return new Response(renderToStaticMarkup(node), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
