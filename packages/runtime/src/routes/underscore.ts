import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ slug: string; path?: string[] }>
}

export type UnderscoreRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Unified internal route handler for no_layout HTML and static bundle
 * posts. Mounted at `app/r/[slug]/[[...path]]/route.ts`; reached via
 * middleware rewrite from the public `/<slug>(/<path>)` URL, never
 * directly.
 *
 * Two cases that both need to bypass the themed post page:
 *
 *  1. `format: 'html'` posts with `metadata.no_layout === true` — the
 *     body is its own complete HTML document and ships as the entire
 *     response. Reached via middleware rewrite of `/<slug>`.
 *  2. `format: 'static'` posts — the body is a manifest describing a
 *     bundle of files in S3 at `public/static/<slug>/`. The bundle's
 *     entrypoint is served at `/<slug>/`, every internal file at
 *     `/<slug>/<relative-path>` (middleware rewrites both to
 *     `/r/<slug>/...`).
 *
 * Routing model:
 *   - File location: `app/r/[slug]/[[...path]]/route.ts`. The literal
 *     folder is `r/` (not `_/` etc.) because Next.js's App Router
 *     skips any path part starting with `_` during route discovery
 *     (see `recursive-readdir` + `ignorePartFilter` in
 *     next/dist/build/route-discovery.js). The `r/` prefix is an
 *     internal filesystem detail — the public URL stays `/<slug>(/...)`.
 *   - `params.path` is `undefined` (or `[]`) for single-segment
 *     requests, an array of remaining segments otherwise.
 *
 * Trailing-slash responsibility lives here. For static bundles the
 * handler 308-redirects `/<slug>` to `/<slug>/` so relative asset
 * paths inside the bundle resolve correctly — `<img src="img.png">`
 * must resolve to `/<slug>/img.png`, not the site root.
 *
 * Trust model: no_layout HTML bodies are emitted verbatim, same trust
 * shape as `format: 'html'` post bodies on the regular path. Static
 * bundle assets are served via short-lived S3 presigned URLs; the
 * bucket stays private. See docs/architecture/04-access-layer-mcp.md
 * §"editor の信頼モデル".
 *
 * Cache-Control: deliberately omitted from the responses here.
 * Middleware computes the strategy from `metadata.cache` +
 * `post.updatedAt` and sets the header on the rewritten response.
 */
export function createUnderscoreRouteHandler(ampless: Ampless): UnderscoreRouteHandler {
  // createServerRunner is expensive (parses outputs, builds resource
  // configs); cache once per process. The route handler closure keeps
  // a reference so cold-start cost is paid once. Same model as the
  // legacy static route handler.
  const { runWithAmplifyServerContext } = createServerRunner({
    config: ampless.outputs as Parameters<typeof createServerRunner>[0]['config'],
  })

  return async function GET(request: Request, { params }: Ctx): Promise<Response> {
    const { slug, path } = await params
    const restSegments = path ?? []

    const post = await ampless.getPublishedPost(slug)
    if (!post) {
      return new Response('Not Found', { status: 404 })
    }

    // Single-segment access: public `/<slug>` or `/<slug>/` (rewritten
    // to `/r/<slug>` by middleware). Distinguish no_layout HTML
    // (`format='html'`) from static bundle entrypoint
    // (`format='static'`).
    if (restSegments.length === 0) {
      if (post.format === 'html' && post.metadata?.no_layout === true) {
        return new Response(ampless.renderBody(post), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Cache-Control set by middleware (cache strategy depends on
            // post.metadata.cache + post.updatedAt).
          },
        })
      }
      if (post.format === 'static') {
        const url = new URL(request.url)
        if (!url.pathname.endsWith('/')) {
          // Anchor relative paths inside the bundle to `/<slug>/...`.
          const next = new URL(url)
          next.pathname = `${url.pathname}/`
          return Response.redirect(next.toString(), 308)
        }
        const body = (post.body ?? null) as { entrypoint?: string } | null
        const entrypoint =
          typeof body?.entrypoint === 'string' && body.entrypoint
            ? body.entrypoint
            : 'index.html'
        const presignedUrl = await signStaticAsset({
          runWithAmplifyServerContext,
          slug,
          rest: entrypoint,
        })
        if (!presignedUrl) {
          return new Response('Not Found', { status: 404 })
        }
        return Response.redirect(presignedUrl, 302)
      }
      // Any other shape (tiptap, markdown, html without no_layout)
      // arriving here is a middleware bug — those slugs should never
      // be rewritten to `/r/`. Return 404 defensively so we don't leak
      // a chrome-free body.
      return new Response('Not Found', { status: 404 })
    }

    // Multi-segment access: only meaningful for static bundles.
    if (post.format !== 'static') {
      return new Response('Not Found', { status: 404 })
    }

    // Reject traversal / null bytes / cross-segment slashes — same
    // hardening as /api/media/[...path] and the legacy static route.
    if (
      restSegments.some(
        (s) => !s || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0'),
      )
    ) {
      return new Response('Invalid path', { status: 400 })
    }

    const body = (post.body ?? null) as { files?: string[] } | null
    const fileList = Array.isArray(body?.files) ? body.files : []
    const rest = restSegments.join('/')

    // Cheap pre-flight: if the manifest knows the file list and the
    // requested file isn't in it, skip the S3 round-trip. Empty file
    // lists (legacy / partial uploads) bypass this and try S3 anyway.
    if (fileList.length > 0 && !fileList.includes(rest)) {
      return new Response('Not Found', { status: 404 })
    }

    const presignedUrl = await signStaticAsset({
      runWithAmplifyServerContext,
      slug,
      rest,
    })
    if (!presignedUrl) {
      return new Response('Not Found', { status: 404 })
    }
    return Response.redirect(presignedUrl, 302)
    // (Cache-Control deliberately omitted from the redirect: the
    // presigned URL itself ages out in an hour, and the browser
    // already caches the underlying S3 response per S3's own headers.
    // Adding a stale-while-revalidate window on the 302 risks serving
    // an expired presign to repeat visitors.)
  }
}

interface SignStaticAssetArgs {
  runWithAmplifyServerContext: ReturnType<typeof createServerRunner>['runWithAmplifyServerContext']
  slug: string
  rest: string
}

/**
 * Sign a 1-hour presigned URL for `public/static/<slug>/<rest>`.
 * Returns null when the object is missing or any Amplify-layer error
 * occurs — distinguishing the two reliably isn't possible through
 * Amplify's wrapper (both surface as throws). Callers turn null into
 * a 404; check CloudWatch / Sentry for transport-layer failures.
 */
async function signStaticAsset({
  runWithAmplifyServerContext,
  slug,
  rest,
}: SignStaticAssetArgs): Promise<string | null> {
  const objectPath = `public/static/${slug}/${rest}`
  try {
    return await runWithAmplifyServerContext({
      nextServerContext: { cookies },
      operation: async (amplifyContext) => {
        const result = await getUrl(amplifyContext, {
          path: objectPath,
          options: { expiresIn: 60 * 60 },
        })
        return result.url.toString()
      },
    })
  } catch (err) {
    console.error(
      `[underscore-route] presign failed for ${objectPath}:`,
      err,
    )
    return null
  }
}
