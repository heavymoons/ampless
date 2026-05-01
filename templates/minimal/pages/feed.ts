import { publicAssetUrl } from '@/lib/storage'

interface Ctx {
  siteId: string
  request: Request
}

// /feed.xml proxy — plugin-rss regenerates the feed on content events
// and writes it to `public/plugins/rss/{siteId}/feed.xml`.
export async function minimalFeedHandler({ siteId }: Ctx): Promise<Response> {
  const url = publicAssetUrl(`public/plugins/rss/${siteId}/feed.xml`)
  const upstream = await fetch(url, { cache: 'no-store' })
  if (!upstream.ok) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel></channel></rss>\n`,
      {
        status: 200,
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      }
    )
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
