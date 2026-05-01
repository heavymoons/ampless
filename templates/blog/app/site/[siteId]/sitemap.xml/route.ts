import { publicAssetUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string }>
}

// /sitemap.xml proxy — plugin-seo regenerates the sitemap on every
// content event and writes it to `public/plugins/seo/{siteId}/sitemap.xml`.
export async function GET(_request: Request, { params }: Props) {
  const { siteId } = await params
  const url = publicAssetUrl(`public/plugins/seo/${siteId}/sitemap.xml`)
  const upstream = await fetch(url, { cache: 'no-store' })
  if (!upstream.ok) {
    // Empty sitemap before any publish has happened — keep crawlers happy.
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
