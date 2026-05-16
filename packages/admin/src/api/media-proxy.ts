import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import type { Admin } from '../index.js'

/**
 * Build the `/api/media/[...path]` route handler. Proxies uploaded
 * media through Next.js so embedded `<img src>` URLs stay permanent.
 * The browser hits `/api/media/<path>`, this route fetches the
 * short-lived presigned URL via Amplify SSR, then redirects.
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
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    const objectPath = `public/${path.join('/')}`

    try {
      const url = await runWithAmplifyServerContext({
        nextServerContext: { cookies },
        operation: async (amplifyContext) => {
          const result = await getUrl(amplifyContext, {
            path: objectPath,
            options: { expiresIn: 60 * 60 },
          })
          return result.url.toString()
        },
      })

      // 302 redirect — browser follows to S3 presigned URL.
      // Cache the redirect for 5 minutes so repeated views don't re-issue presigns.
      return NextResponse.redirect(url, {
        status: 302,
        headers: { 'Cache-Control': 'public, max-age=300' },
      })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to fetch media' },
        { status: 404 }
      )
    }
  }

  return { GET }
}
