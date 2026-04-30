import type { Post, Config } from 'ampless'

export interface SitemapOptions {
  /** Maximum number of URLs to include. Default 5000. */
  limit?: number
  /** Override base URL (defaults to config.site.url). */
  siteUrl?: string
  /** Default changefreq for post URLs. */
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  /** Default priority (0..1) for post URLs. */
  priority?: number
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const toIsoDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

export function buildSitemap(
  posts: Post[],
  site: Config['site'],
  options: SitemapOptions = {}
): string {
  const baseUrl = (options.siteUrl ?? site.url).replace(/\/$/, '')
  const limit = options.limit ?? 5000
  const changefreq = options.changefreq ?? 'weekly'
  const priority = options.priority ?? 0.7

  const homeEntry = `  <url>
    <loc>${escapeXml(baseUrl + '/')}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`

  const postEntries = posts
    .filter((p) => p.status === 'published')
    .slice(0, limit)
    .map((post) => {
      const url = `${baseUrl}/${post.slug}`
      const lastmod = post.publishedAt ? toIsoDate(post.publishedAt) : ''
      const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''
      return `  <url>
    <loc>${escapeXml(url)}</loc>${lastmodTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${homeEntry}
${postEntries}
</urlset>
`
}
