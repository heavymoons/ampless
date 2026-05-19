import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ siteId: string; path: string[] }>
}

export type StaticRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * MIME types served for each extension. The presigned URL S3 returns
 * already carries Content-Type metadata (forced by the admin uploader),
 * so this map is only used as a fallback for the trailing-slash 308
 * response body — it's never actually emitted on the asset path.
 */
const FALLBACK_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
}

/**
 * Catch-all route for static bundles. Lives at
 * `app/site/[siteId]/[...path]/route.ts` and serves every file
 * inside a `format: 'static'` post's bundle. The first segment of
 * `path` is the post slug; the rest is the relative path inside the
 * bundle (or empty, in which case the manifest's entrypoint is used).
 *
 * Routing precedence: Next.js prefers the more specific
 * `[siteId]/[slug]/page.tsx` for single-segment URLs, so this catch-all
 * only fires when path.length >= 2. The post dispatcher detects
 * `format === 'static'` and 308-redirects to `/<slug>/<entrypoint>`
 * so the catch-all picks up from there.
 *
 * Single-segment requests (`/<siteId>/<slug>`) that somehow do reach
 * here are 308-redirected to add a trailing slash, which is what makes
 * relative paths in the bundle resolve correctly in the browser.
 *
 * Implementation: generate a short-lived presigned URL for the S3
 * object and 302-redirect to it. Same model as `/api/media/[...path]`
 * — keeps the bucket private while letting CloudFront cache the 302
 * for the Cache-Control window. The presigned URL itself expires in
 * an hour; the 302 cache is 5 minutes so re-issued presigns stay
 * fresh.
 */
export function createStaticRouteHandler(ampless: Ampless): StaticRouteHandler {
  // createServerRunner is expensive (parses outputs, builds resource
  // configs); cache once per process. The route handler closure keeps
  // a reference so cold-start cost is paid once.
  const { runWithAmplifyServerContext } = createServerRunner({
    config: ampless.outputs as Parameters<typeof createServerRunner>[0]['config'],
  })

  return async function GET(request: Request, { params }: Ctx): Promise<Response> {
    const { siteId, path } = await params
    if (!path || path.length === 0) {
      return new Response('Not Found', { status: 404 })
    }

    const slug = path[0]!
    const restSegments = path.slice(1)

    // Reject traversal / null bytes / cross-segment slashes — same
    // hardening as /api/media/[...path].
    if (
      restSegments.some(
        (s) => !s || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0'),
      )
    ) {
      return new Response('Invalid path', { status: 400 })
    }

    const post = await ampless.getPublishedPost(slug, { siteId })
    if (!post || post.format !== 'static') {
      return new Response('Not Found', { status: 404 })
    }

    const body = (post.body ?? null) as { entrypoint?: string; files?: string[] } | null
    const entrypoint =
      typeof body?.entrypoint === 'string' && body.entrypoint ? body.entrypoint : 'index.html'
    const fileList = Array.isArray(body?.files) ? body.files : []

    let rest = restSegments.join('/')

    // Single-segment access (e.g. `/site/<id>/<slug>`): the dispatcher
    // SHOULD have redirected away, but if a client lands here directly
    // we serve the entrypoint with a trailing-slash redirect so
    // relative refs in the HTML resolve under `/<slug>/…` rather than
    // the site root.
    if (rest === '') {
      const url = new URL(request.url)
      if (!url.pathname.endsWith('/')) {
        const next = new URL(url)
        next.pathname = `${url.pathname}/`
        return Response.redirect(next.toString(), 308)
      }
      rest = entrypoint
    }

    // Cheap pre-flight: if the manifest knows the file list and the
    // requested file isn't in it, skip the S3 round-trip. Empty file
    // lists (legacy / partial uploads) bypass this and try S3 anyway.
    if (fileList.length > 0 && !fileList.includes(rest)) {
      return new Response('Not Found', { status: 404 })
    }

    const objectPath = `public/static/${siteId}/${slug}/${rest}`
    try {
      const presignedUrl = await runWithAmplifyServerContext({
        nextServerContext: { cookies },
        operation: async (amplifyContext) => {
          const result = await getUrl(amplifyContext, {
            path: objectPath,
            options: { expiresIn: 60 * 60 },
          })
          return result.url.toString()
        },
      })
      return Response.redirect(presignedUrl, 302)
      // (Cache-Control deliberately omitted from the redirect: the
      // presigned URL itself ages out in an hour, and the browser
      // already caches the underlying S3 response per S3's own
      // headers. Adding a stale-while-revalidate window on the 302
      // tier risks serving an expired presign to repeat visitors.)
    } catch {
      // Distinguish missing objects (most common) from auth / S3 errors
      // is unreliable through Amplify's wrapper — both surface as
      // throws. Caller sees 404 either way; check CloudWatch / Sentry
      // for transport-layer failures.
      const ext = rest.slice(rest.lastIndexOf('.'))
      const fallback = FALLBACK_MIME[ext] ?? 'text/plain; charset=utf-8'
      return new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': fallback },
      })
    }
  }
}
