import { publicAssetUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

// /feed.xml — same pattern as /sitemap.xml. plugin-rss regenerates the
// feed on content.published / unpublished / deleted and stores it at
// `public/plugins/rss/feed.xml`.
export async function GET() {
  const url = publicAssetUrl('public/plugins/rss/feed.xml')
  if (!url) {
    return new Response('Sandbox not deployed', { status: 503 })
  }
  const upstream = await fetch(url, { cache: 'no-store' })
  if (!upstream.ok) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel></channel></rss>\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    })
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
