import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ slug: string; path?: string[] }>
}

export type StaticRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Internal route handler for `format: 'static'` posts — the body is a
 * manifest describing a bundle of files in S3 at
 * `public/static/<slug>/`. The bundle entrypoint is served at
 * `/<slug>/`, every internal file at `/<slug>/<relative-path>`.
 *
 * Mounted at `app/static/[slug]/[[...path]]/route.ts`; reached via
 * middleware rewrite of `/<slug>(/<path>)` → `/static/<slug>(/<path>)`.
 * Never hit directly — middleware adds `static` to its reserved-prefix
 * list so a user post with slug `static` passes through to a 404
 * rather than landing here with the wrong content.
 *
 * Trailing-slash responsibility lives here: `/<slug>` (no trailing
 * slash) 308-redirects to `/<slug>/` so relative asset paths inside
 * the bundle resolve correctly — `<img src="img.png">` must resolve
 * to `/<slug>/img.png`, not the site root.
 *
 * Trust model: assets are served via short-lived S3 presigned URLs;
 * the bucket stays private.
 *
 * Cache-Control: deliberately omitted from the responses here.
 * Middleware computes the strategy from `metadata.cache` +
 * `post.updatedAt` and sets it on the rewritten response. The 302
 * presigned redirects also rely on S3's own headers for the actual
 * asset bytes — adding a stale-while-revalidate window on the 302
 * would risk serving an expired presign to repeat visitors.
 */
export function createStaticRouteHandler(ampless: Ampless): StaticRouteHandler {
  // createServerRunner is expensive (parses outputs, builds resource
  // configs); cache once per process. The route handler closure keeps
  // a reference so cold-start cost is paid once.
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
    if (post.format !== 'static') {
      // Middleware bug — only static posts should land here.
      return new Response('Not Found', { status: 404 })
    }

    if (restSegments.length === 0) {
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

    // Reject traversal / null bytes / cross-segment slashes — same
    // hardening as /api/media/[...path].
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
    // lists (partial uploads) bypass this and try S3 anyway.
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
      `[static-route] presign failed for ${objectPath}:`,
      err,
    )
    return null
  }
}
