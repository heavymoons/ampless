import type { Post } from 'ampless'
import { DEFAULT_SITE_ID } from 'ampless'
import type { Metadata } from 'next'
import cmsConfig from '@/cms.config'
import { loadSiteSettings } from './site-settings'

function isPlugin(p: unknown): p is import('ampless').AmplessPlugin {
  return typeof p === 'object' && p !== null && 'apiVersion' in p
}

const plugins = (cmsConfig.plugins ?? []).filter(isPlugin)

// Aggregate per-post metadata across every active plugin's metadata()
// hook. Last plugin wins on collision; openGraph / twitter / alternates
// merge shallowly so seo + rss can both contribute.
export async function postMetadata(
  post: Post,
  siteId: string = DEFAULT_SITE_ID
): Promise<Metadata> {
  const settings = await loadSiteSettings(siteId)
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
}

export async function siteMetadata(siteId: string = DEFAULT_SITE_ID): Promise<Metadata> {
  const settings = await loadSiteSettings(siteId)
  const accum: Metadata = {
    title: settings.site.name,
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
}
