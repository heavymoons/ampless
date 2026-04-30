import type { Post, Config } from 'ampless'

export interface RssFeedOptions {
  /** Number of most recent posts to include. Default 20. */
  limit?: number
  /** Override site URL (e.g. for staging). Defaults to config.site.url. */
  siteUrl?: string
  /** Path to expose the feed at. Default '/feed.xml'. */
  feedPath?: string
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const toRfc822 = (iso: string): string => new Date(iso).toUTCString()

export function buildRssFeed(
  posts: Post[],
  site: Config['site'],
  options: RssFeedOptions = {}
): string {
  const baseUrl = (options.siteUrl ?? site.url).replace(/\/$/, '')
  const feedPath = options.feedPath ?? '/feed.xml'
  const limit = options.limit ?? 20

  const items = posts
    .filter((p) => p.status === 'published')
    .slice(0, limit)
    .map((post) => {
      const url = `${baseUrl}/${post.slug}`
      const pubDate = post.publishedAt ? toRfc822(post.publishedAt) : new Date().toUTCString()
      const description = post.excerpt ?? ''
      const tags = (post.tags ?? [])
        .map((t) => `      <category>${escapeXml(t)}</category>`)
        .join('\n')
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
${tags ? tags + '\n' : ''}      <description>${escapeXml(description)}</description>
    </item>`
    })
    .join('\n')

  const lastBuild = new Date().toUTCString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(site.description ?? site.name)}</description>
    <atom:link href="${escapeXml(baseUrl + feedPath)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`
}
