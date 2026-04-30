import type { Post } from 'ampless'
import type { Metadata } from 'next'
import cmsConfig from '@/cms.config'

function isPlugin(p: unknown): p is import('ampless').AmplessPlugin {
  return typeof p === 'object' && p !== null && 'apiVersion' in p
}

const plugins = (cmsConfig.plugins ?? []).filter(isPlugin)

// Aggregate per-post metadata across every active plugin's metadata()
// hook. Last plugin wins on collision; openGraph / twitter / alternates
// merge shallowly so seo + rss can both contribute.
export function postMetadata(post: Post): Metadata {
  const accum: Metadata = {}
  for (const plugin of plugins) {
    if (!plugin.metadata) continue
    const m = plugin.metadata(post, cmsConfig.site)
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

export function siteMetadata(): Metadata {
  const accum: Metadata = {
    title: cmsConfig.site.name,
    description: cmsConfig.site.description,
  }
  for (const plugin of plugins) {
    if (!plugin.siteMetadata) continue
    const m = plugin.siteMetadata(cmsConfig.site)
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
