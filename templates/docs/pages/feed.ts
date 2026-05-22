import { publicAssetUrl } from '@/lib/storage'

interface Ctx {
  request: Request
}

export async function docsFeedHandler(_ctx: Ctx): Promise<Response> {
  const url = publicAssetUrl('public/plugins/rss/feed.xml')
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
