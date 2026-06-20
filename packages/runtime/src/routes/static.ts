import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import type { PostMetadata, StaticPostFileMeta } from 'ampless'
import type { Ampless } from '../index.js'
import {
  streamS3Object,
  type ResolvedAssetMeta,
  type StreamS3Options,
} from '../stream-s3.js'

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
 * Trust model: the bucket stays private. Small files (<=6 MB) are
 * streamed back through the Lambda response so CloudFront caches
 * them; larger files fall back to a short-lived S3 presigned redirect.
 *
 * Cache-Control: deliberately omitted from the responses here.
 * Middleware computes the strategy from `metadata.cache` +
 * `post.updatedAt` and overlays it on the rewritten response.
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

    const metadata: PostMetadata | undefined = post.metadata
    const filesMeta: Record<string, StaticPostFileMeta> | undefined =
      metadata && typeof metadata.files === 'object' && metadata.files !== null
        ? (metadata.files as Record<string, StaticPostFileMeta>)
        : undefined

    if (restSegments.length === 0) {
      const url = new URL(request.url)
      if (!url.pathname.endsWith('/')) {
        // Anchor relative paths inside the bundle to `/<slug>/...`. Use a
        // host-relative Location so the browser resolves it against the
        // public origin. `request.url` reports the internal origin (e.g.
        // localhost:3000) under Amplify SSR / behind a proxy, so an
        // absolute Location built from it would bounce the visitor to
        // localhost — which also trips Chrome's local-network prompt.
        return new Response(null, {
          status: 308,
          headers: { Location: `${url.pathname}/${url.search}` },
        })
      }
      const body = (post.body ?? null) as { entrypoint?: string } | null
      const entrypoint =
        typeof body?.entrypoint === 'string' && body.entrypoint
          ? body.entrypoint
          : 'index.html'
      return serveStaticAsset({
        runWithAmplifyServerContext,
        slug,
        rest: entrypoint,
        filesMeta,
      })
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

    return serveStaticAsset({
      runWithAmplifyServerContext,
      slug,
      rest,
      filesMeta,
    })
  }
}

interface ServeStaticAssetArgs {
  runWithAmplifyServerContext: ReturnType<typeof createServerRunner>['runWithAmplifyServerContext']
  slug: string
  rest: string
  filesMeta: Record<string, StaticPostFileMeta> | undefined
}

/**
 * Resolve the S3 key, look up persisted size/mimeType, and hand off
 * to the stream-back helper. Small files are streamed back so
 * CloudFront caches the response; larger files fall back to a 302
 * presigned redirect. The route never sets Cache-Control on the
 * response — middleware overlays it from `post.metadata.cache` +
 * `post.updatedAt`.
 *
 * TODO(stream-s3): backfill `post.metadata.files` for legacy bundles
 * uploaded before the metadata-on-write migration. Today they fall
 * through to a HEAD via Amplify SSR (cached in the per-Lambda LRU),
 * but a one-shot migration would drop the cold-start HEAD entirely.
 */
async function serveStaticAsset({
  runWithAmplifyServerContext,
  slug,
  rest,
  filesMeta,
}: ServeStaticAssetArgs): Promise<Response> {
  const key = `public/static/${slug}/${rest}`
  const persisted = filesMeta?.[rest]
  const meta: ResolvedAssetMeta | undefined = persisted
    ? { size: persisted.size, mimeType: persisted.mimeType }
    : undefined

  const opts: StreamS3Options = {
    meta,
    presignedUrlFor: (k) => signStaticAsset({ runWithAmplifyServerContext, key: k }),
  }

  return runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (ctx) => streamS3Object(ctx, key, opts),
  })
}

interface SignStaticAssetArgs {
  runWithAmplifyServerContext: ReturnType<typeof createServerRunner>['runWithAmplifyServerContext']
  key: string
}

/**
 * Sign a 1-hour presigned URL for the given S3 key. Returns null on
 * any Amplify-layer error (NoSuchKey + transport errors both surface
 * as throws through the SSR wrapper). Callers turn null into a 404;
 * check CloudWatch / Sentry for transport-layer failures.
 */
async function signStaticAsset({
  runWithAmplifyServerContext,
  key,
}: SignStaticAssetArgs): Promise<string | null> {
  try {
    return await runWithAmplifyServerContext({
      nextServerContext: { cookies },
      operation: async (amplifyContext) => {
        const result = await getUrl(amplifyContext, {
          path: key,
          options: { expiresIn: 60 * 60 },
        })
        return result.url.toString()
      },
    })
  } catch (err) {
    console.error(`[static-route] presign failed for ${key}:`, err)
    return null
  }
}
