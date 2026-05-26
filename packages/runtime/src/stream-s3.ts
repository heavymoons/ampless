// Stream-back helper for S3-backed assets.
//
// Rationale: the previous routes 302-redirected the browser to an S3
// presigned URL, so the bytes never traversed the Amplify Hosting
// CloudFront edge cache. Each repeat read paid for another Lambda
// invocation + S3 GET. Streaming the bytes back through the Lambda
// response lets CloudFront cache the response under the original
// `/api/media/...` / `/<slug>/<path>` URL.
//
// Implementation note: Amplify Storage's server-side API surface
// (`@aws-amplify/storage/server`) intentionally omits `downloadData`
// — only `getProperties`, `getUrl`, `list`, `remove`, `copy`, and
// `uploadData` are exported. So the Lambda mints a presigned URL via
// `getUrl` (same path the old 302 used) and then `fetch()`'s it
// itself, piping the body back to the response. The extra in-region
// hop is cheap; the benefit is that CloudFront caches the response
// and future hits don't reach Lambda at all.
//
// Hard ceiling on stream-back: 6 MB. Amplify Hosting SSR Lambdas run
// in buffered response mode by default, capping a single response at
// ~6 MB. Larger files fall back to the original 302-presigned path
// so the browser fetches them direct from S3 (CloudFront miss, but
// the request succeeds). See `thresholdBytes` below to tune.

import { getProperties } from 'aws-amplify/storage/server'
import { cookies } from 'next/headers'
// Type-only import: the SSR helpers accept the runtime's context
// shape but typing it tightly costs a peer dep on the adapter's
// internals, which churn between minor versions. The concrete value
// flows through `runWithContext` callbacks owned by the caller.
type AmplifyServerContext = Parameters<typeof getProperties>[0]

/** Metadata sufficient to choose between stream-back and 302 fallback. */
export interface ResolvedAssetMeta {
  size: number
  mimeType: string
  /** S3 ETag (when known). Passed through to the response so clients can revalidate. */
  etag?: string
}

export interface StreamS3Options {
  /**
   * Override the Cache-Control header on the streamed response.
   * Leave undefined to let the route's middleware overlay
   * (`computeCacheControl`) decide — that's the right answer for
   * static-post asset bytes, since the strategy lives on
   * `post.metadata.cache`. Media uploads pass an immutable header
   * because their S3 keys carry a timestamp prefix.
   */
  cacheControl?: string
  /** Default 6 MiB — matches Amplify SSR Lambda's buffered response cap. */
  thresholdBytes?: number
  /**
   * Caller-supplied metadata (from DynamoDB). Preferred path: when
   * present, no HEAD round-trip is issued.
   */
  meta?: ResolvedAssetMeta
  /**
   * Caller-provided HEAD substitute. Invoked only when `meta` is
   * omitted; result is memoised in the in-process LRU so repeat
   * misses don't all hit S3.
   */
  headFallback?: () => Promise<ResolvedAssetMeta | null>
  /**
   * Required for the 302 fallback path (files larger than the
   * threshold, or stream-fetch errors). Returns a presigned URL or
   * null when the object cannot be signed.
   */
  presignedUrlFor: (key: string) => Promise<string | null>
}

const DEFAULT_THRESHOLD_BYTES = 6 * 1024 * 1024 // 6 MiB

// In-process LRU for HEAD fallback results. Lambdas reuse module
// scope across warm invocations, so a small cache absorbs the
// "no DynamoDB row yet" tail without growing unboundedly.
const META_CACHE_MAX = 1000
const META_CACHE_TTL_MS = 5 * 60_000
const META_CACHE = new Map<string, { meta: ResolvedAssetMeta; expires: number }>()

function metaCacheGet(key: string): ResolvedAssetMeta | undefined {
  const hit = META_CACHE.get(key)
  if (!hit) return undefined
  if (hit.expires < Date.now()) {
    META_CACHE.delete(key)
    return undefined
  }
  // Touch for LRU ordering — re-insertion moves the key to the
  // tail of Map iteration, so `keys().next()` always returns the
  // oldest. Mirrors the middleware flag cache.
  META_CACHE.delete(key)
  META_CACHE.set(key, hit)
  return hit.meta
}

function metaCacheSet(key: string, meta: ResolvedAssetMeta): void {
  if (META_CACHE.size >= META_CACHE_MAX) {
    const oldest = META_CACHE.keys().next().value
    if (oldest !== undefined) META_CACHE.delete(oldest)
  }
  META_CACHE.set(key, { meta, expires: Date.now() + META_CACHE_TTL_MS })
}

/**
 * Exported for tests. Production callers should never need to
 * touch the module-scope cache directly.
 */
export function _resetStreamS3Cache(): void {
  META_CACHE.clear()
}

/**
 * Look up object properties via Amplify SSR. This is the last-ditch
 * fallback when neither caller-supplied metadata nor the
 * `headFallback` produce a result — useful for orphan / legacy
 * assets that predate the metadata-on-write migration. Returns null
 * on any S3 error (including NoSuchKey).
 */
async function headViaAmplify(
  ctx: AmplifyServerContext,
  key: string,
): Promise<ResolvedAssetMeta | null> {
  try {
    const props = await getProperties(ctx, { path: key })
    const size = typeof props.size === 'number' ? props.size : 0
    const mimeType = props.contentType ?? 'application/octet-stream'
    const etag = (props as { eTag?: string }).eTag
    return { size, mimeType, etag }
  } catch (err) {
    // NoSuchKey + transport errors both surface as throws — log so
    // the operator can tell them apart from CloudWatch.
    console.error(`[stream-s3] getProperties failed for ${key}:`, err)
    return null
  }
}

/**
 * Stream the S3 object at `key` back through the Lambda response.
 * Returns a `Response` whose body is the object bytes (for small
 * files) or a 302 redirect to a presigned URL (for files larger
 * than `thresholdBytes`). Missing objects → 404.
 *
 * The Amplify server context is required so the helper can mint a
 * presigned URL through the same auth context the caller already
 * uses (Cognito identity / public role). No extra IAM grant is
 * needed on the Lambda execution role.
 */
export async function streamS3Object(
  amplifyServerContext: AmplifyServerContext,
  key: string,
  options: StreamS3Options,
): Promise<Response> {
  const threshold = options.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES

  // 1) Resolve metadata in priority order: caller-supplied →
  //    caller's headFallback (with LRU memoisation) → Amplify HEAD.
  let meta: ResolvedAssetMeta | null = options.meta ?? null

  if (!meta) {
    const cached = metaCacheGet(key)
    if (cached) {
      meta = cached
    } else if (options.headFallback) {
      try {
        meta = await options.headFallback()
      } catch (err) {
        console.error(`[stream-s3] headFallback threw for ${key}:`, err)
        meta = null
      }
      if (meta) metaCacheSet(key, meta)
    }
  }

  if (!meta) {
    const probed = await headViaAmplify(amplifyServerContext, key)
    if (probed) {
      metaCacheSet(key, probed)
      meta = probed
    }
  }

  if (!meta) {
    return new Response('Not Found', { status: 404 })
  }

  // 2) Size-based branch.
  if (meta.size > threshold) {
    const url = await options.presignedUrlFor(key).catch((err) => {
      console.error(`[stream-s3] presign failed for ${key}:`, err)
      return null
    })
    if (!url) return new Response('Not Found', { status: 404 })
    const headers = new Headers({ Location: url })
    if (options.cacheControl) headers.set('Cache-Control', options.cacheControl)
    return new Response(null, { status: 302, headers })
  }

  // 3) Stream-back path. Mint a presigned URL and pipe the body
  //    back. Lambda → S3 round-trip is in-region (cheap) and the
  //    response is what CloudFront caches.
  const presigned = await options.presignedUrlFor(key).catch((err) => {
    console.error(`[stream-s3] presign failed for ${key}:`, err)
    return null
  })
  if (!presigned) return new Response('Not Found', { status: 404 })

  let upstream: Response
  try {
    upstream = await fetch(presigned)
  } catch (err) {
    console.error(`[stream-s3] upstream fetch failed for ${key}:`, err)
    return new Response('Bad Gateway', { status: 502 })
  }

  if (upstream.status === 404 || upstream.status === 403) {
    // 403 happens when the object was deleted between the presign and
    // the fetch — treat as 404 for the public surface.
    return new Response('Not Found', { status: 404 })
  }
  if (!upstream.ok || !upstream.body) {
    console.error(
      `[stream-s3] upstream returned ${upstream.status} for ${key}`,
    )
    return new Response('Bad Gateway', { status: 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', meta.mimeType)
  // Prefer the actual bytes-on-wire count from S3 over our cached
  // size — they should match, but the upstream header is the
  // authoritative one for the response.
  const contentLength = upstream.headers.get('Content-Length')
  if (contentLength) {
    headers.set('Content-Length', contentLength)
  } else {
    headers.set('Content-Length', String(meta.size))
  }
  const upstreamEtag = upstream.headers.get('ETag') ?? meta.etag
  if (upstreamEtag) headers.set('ETag', upstreamEtag)
  if (options.cacheControl) headers.set('Cache-Control', options.cacheControl)

  return new Response(upstream.body, { status: 200, headers })
}

/**
 * Convenience wrapper that pulls in the standard Amplify SSR cookie
 * adapter so route handlers don't have to duplicate the
 * `runWithAmplifyServerContext` plumbing. Pass the runner from
 * `createServerRunner({ config: outputs })` and the rest is the same
 * shape as `streamS3Object`.
 */
export async function streamS3ObjectWithRunner(
  runWithAmplifyServerContext: <T>(args: {
    nextServerContext: { cookies: typeof cookies }
    operation: (ctx: AmplifyServerContext) => Promise<T>
  }) => Promise<T>,
  key: string,
  options: StreamS3Options,
): Promise<Response> {
  return runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (ctx) => streamS3Object(ctx, key, options),
  })
}
