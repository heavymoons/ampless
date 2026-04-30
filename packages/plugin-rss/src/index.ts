import { definePlugin, type AmplessPlugin, type PluginMetadata } from 'ampless'
import { buildRssFeed, type RssFeedOptions } from './feed.js'

export interface RssPluginOptions extends RssFeedOptions {}

/**
 * RSS / Atom feed plugin.
 *
 * On `content.published`, `content.unpublished`, and `content.deleted`
 * events, regenerates the site feed from all currently-published posts and
 * stores it at `public/plugins/rss/feed.xml`. The Next.js `/feed.xml`
 * route serves this object.
 *
 * Adds a <link rel="alternate" type="application/rss+xml"> to the site
 * metadata so feed readers can autodiscover.
 */
export default function rssPlugin(options: RssPluginOptions = {}): AmplessPlugin {
  const feedPath = options.feedPath ?? '/feed.xml'

  async function rebuild(_event: unknown, ctx: import('ampless').PluginRuntimeContext) {
    const posts = await ctx.listPublishedPosts()
    const xml = buildRssFeed(posts, ctx.site, options)
    await ctx.writePublicAsset('feed.xml', xml, 'application/rss+xml; charset=utf-8')
  }

  return definePlugin({
    name: 'rss',
    apiVersion: 1,
    trust_level: 'trusted',
    hooks: {
      'content.published': rebuild,
      'content.unpublished': rebuild,
      'content.deleted': rebuild,
      // Updates can change title/excerpt of an already-published post, so
      // we regenerate on every update too.
      'content.updated': rebuild,
    },
    siteMetadata(site): PluginMetadata {
      const baseUrl = (options.siteUrl ?? site.url).replace(/\/$/, '')
      return {
        alternates: {
          types: {
            'application/rss+xml': baseUrl + feedPath,
          },
        },
      }
    },
  })
}

export { buildRssFeed }
export type { RssFeedOptions }
