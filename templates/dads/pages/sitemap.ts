import { ampless } from '@/lib/ampless'

interface Ctx {
  request: Request
}

export async function dadsSitemapHandler(_ctx: Ctx): Promise<Response> {
  const url = ampless.publicAssetUrl('public/plugins/seo/sitemap.xml')
  const upstream = await fetch(url, { cache: 'no-store' })
  if (!upstream.ok) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`,
      {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      }
    )
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
