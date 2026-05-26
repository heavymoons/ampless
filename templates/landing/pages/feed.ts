import { ampless } from '@/lib/ampless'

interface Ctx {
  request: Request
}

// /feed.xml proxy — plugin-rss writes the feed to
// `public/plugins/rss/feed.xml`. Same flow as the blog theme.
export async function landingFeedHandler(_ctx: Ctx): Promise<Response> {
  const url = ampless.publicAssetUrl('public/plugins/rss/feed.xml')
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
