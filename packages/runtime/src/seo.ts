import type { Post, Config, AmplessPlugin } from 'ampless'
import type { Metadata } from 'next'
import type { SiteSettingsApi } from './site-settings.js'

function isPlugin(p: unknown): p is AmplessPlugin {
  return typeof p === 'object' && p !== null && 'apiVersion' in p
}

export interface SeoApi {
  postMetadata(post: Post): Promise<Metadata>
  siteMetadata(): Promise<Metadata>
}

export function createSeo(cmsConfig: Config, settingsApi: SiteSettingsApi): SeoApi {
  const plugins = (cmsConfig.plugins ?? []).filter(isPlugin)

  // Aggregate per-post metadata across every active plugin's metadata()
  // hook. Last plugin wins on collision; openGraph / twitter / alternates
  // merge shallowly so seo + rss can both contribute.
  return {
    async postMetadata(post: Post): Promise<Metadata> {
      const settings = await settingsApi.loadSiteSettings()
      const accum: Metadata = {}
      for (const plugin of plugins) {
        if (!plugin.metadata) continue
        const m = plugin.metadata(post, settings.site)
        Object.assign(accum, m, {
          openGraph: { ...(accum.openGraph ?? {}), ...(m.openGraph ?? {}) },
          twitter: { ...(accum.twitter ?? {}), ...(m.twitter ?? {}) },
          alternates: {
            ...(accum.alternates ?? {}),
            ...(m.alternates ?? {}),
            types: { ...(accum.alternates?.types ?? {}), ...(m.alternates?.types ?? {}) },
          },
        } as Metadata)
      }
      return accum
    },

    async siteMetadata(): Promise<Metadata> {
      const settings = await settingsApi.loadSiteSettings()
      const accum: Metadata = {
        title: String(settings.site.name ?? ''),
        description: settings.site.description,
      }
      for (const plugin of plugins) {
        if (!plugin.siteMetadata) continue
        const m = plugin.siteMetadata(settings.site)
        Object.assign(accum, m, {
          openGraph: { ...(accum.openGraph ?? {}), ...(m.openGraph ?? {}) },
          twitter: { ...(accum.twitter ?? {}), ...(m.twitter ?? {}) },
          alternates: {
            ...(accum.alternates ?? {}),
            ...(m.alternates ?? {}),
            types: { ...(accum.alternates?.types ?? {}), ...(m.alternates?.types ?? {}) },
          },
        } as Metadata)
      }
      return accum
    },
  }
}
