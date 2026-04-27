import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUrl } from 'aws-amplify/storage/server'
import { runWithAmplifyServerContext } from '@/lib/amplify-server'

// Proxy uploaded media through Next.js so embedded <img src> URLs stay
// permanent. The browser hits /api/media/<path>, this route fetches the
// short-lived presigned URL via Amplify SSR, then redirects.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
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
