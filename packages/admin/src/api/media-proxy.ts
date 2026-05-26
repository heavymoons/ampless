import { type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import {
  streamS3Object,
  type ResolvedAssetMeta,
  type StreamS3Options,
} from '@ampless/runtime'
import type { Admin } from '../index.js'

/**
 * Build the `/api/media/[...path]` route handler. Proxies uploaded
 * media through Next.js so embedded `<img src>` URLs stay permanent.
 *
 * Delivery model: small files (<=6 MB) are streamed back through the
 * Lambda response so Amplify Hosting's CloudFront edge cache can
 * serve repeat hits without re-invoking Lambda. Larger files fall
 * back to a 302 presigned redirect (CloudFront miss, but the
 * response stays under the Lambda buffered-response cap). The
 * bucket stays private throughout.
 *
 * Metadata resolution order:
 *   1. `admin.getMediaBySrc(key)` — public-keyed AppSync custom query
 *      that returns the persisted `{ size, mimeType, etag }` for the
 *      asset. One O(1) DynamoDB Query via the `bySrc` GSI.
 *   2. Amplify SSR HEAD via `getProperties` — fallback for orphan /
 *      legacy assets whose Media row was never written. Memoised in
 *      the stream-back helper's per-Lambda LRU.
 *
 * Used when `cms.config.media.delivery !== 's3-direct'` (default).
 */
export function createMediaProxyRoute(admin: Admin) {
  const { runWithAmplifyServerContext } = admin.amplifyServer

  async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params

    // Reject path traversal, slashes inside segments, and empty segments. The
    // `public/` prefix below would otherwise be escapable with values like
    // ".." or "..%2F..".
    if (
      !path.length ||
      path.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('/') ||
          segment.includes('\\') ||
          segment.includes('\0')
      )
    ) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const key = `public/${path.join('/')}`

    // 1) Try the DynamoDB Media row first. The persisted size +
    //    mimeType lets the stream-back helper skip its HEAD fallback
    //    entirely on the warm path. Failures are logged inside the
    //    helper and surface as null so the route still serves bytes
    //    via the Amplify HEAD fallback.
    const persisted = await admin.getMediaBySrc(key)
    const meta: ResolvedAssetMeta | undefined = persisted
      ? {
          size: persisted.size ?? 0,
          mimeType:
            persisted.mimeType ?? 'application/octet-stream',
          etag:
            typeof persisted.metadata?.etag === 'string'
              ? persisted.metadata.etag
              : undefined,
        }
      : undefined

    // Media keys are timestamp-prefixed and never overwritten in
    // place, so the bytes at a given key are effectively immutable.
    // 1-year immutable is the right shape for both browser and CDN.
    const opts: StreamS3Options = {
      cacheControl: 'public, max-age=31536000, immutable',
      meta,
      presignedUrlFor: (k) => signMediaUrl({ runWithAmplifyServerContext, key: k }),
    }

    return runWithAmplifyServerContext({
      nextServerContext: { cookies },
      operation: (amplifyContext) => streamS3Object(amplifyContext, key, opts),
    })
  }

  return { GET }
}

interface SignMediaUrlArgs {
  runWithAmplifyServerContext: Admin['amplifyServer']['runWithAmplifyServerContext']
  key: string
}

/**
 * Mint a 1-hour presigned URL for the given S3 key. Returns null on
 * any Amplify-layer error so the stream-back helper can turn that
 * into a 404; check CloudWatch / Sentry for the actual cause.
 */
async function signMediaUrl({
  runWithAmplifyServerContext,
  key,
}: SignMediaUrlArgs): Promise<string | null> {
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
    console.error(`[media-proxy] presign failed for ${key}:`, err)
    return null
  }
}
