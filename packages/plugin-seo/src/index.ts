import { definePlugin, type AmplessPlugin } from 'ampless'
import { buildSitemap, type SitemapOptions } from './sitemap.js'
import { buildPostMetadata, buildSiteMetadata, type SeoMetadataOptions } from './metadata.js'

export interface SeoPluginOptions extends SitemapOptions, SeoMetadataOptions {}

/**
 * SEO plugin: regenerates `sitemap.xml` whenever a post's published state
 * changes, and provides Next.js `generateMetadata`-compatible per-post and
 * per-site metadata (title, description, OGP, Twitter card, canonical).
 *
 * Lambda side stores the sitemap at
 * `s3://{bucket}/public/plugins/seo/sitemap.xml`. The Next.js
 * `/sitemap.xml` route streams that object through.
 */
export default function seoPlugin(options: SeoPluginOptions = {}): AmplessPlugin {
  async function rebuild(_event: unknown, ctx: import('ampless').PluginRuntimeContext) {
    const posts = await ctx.listPublishedPosts()
    const xml = buildSitemap(posts, ctx.site, options)
    await ctx.writePublicAsset('sitemap.xml', xml, 'application/xml; charset=utf-8')
  }

  return definePlugin({
    name: 'seo',
    packageName: '@ampless/plugin-seo',
    apiVersion: 1,
    trust_level: 'trusted',
    capabilities: ['eventHooks', 'writePublicAsset', 'metadata'],
    hooks: {
      'content.published': rebuild,
      'content.unpublished': rebuild,
      'content.deleted': rebuild,
      // Updates can change title/slug of an already-published post, so we
      // regenerate on every update too. listPublishedPosts() filters
      // drafts, so an update on a draft just produces the same XML.
      'content.updated': rebuild,
    },
    metadata(post, site) {
      return buildPostMetadata(post, site, options)
    },
    siteMetadata(site) {
      return buildSiteMetadata(site, options)
    },
  })
}

export { buildSitemap, buildPostMetadata, buildSiteMetadata }
export type { SitemapOptions, SeoMetadataOptions }
