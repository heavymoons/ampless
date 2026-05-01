import { DEFAULT_SITE_ID } from 'ampless'
import { themes, DEFAULT_THEME, type ThemeName } from '@/themes-registry'
import { publicAssetUrl, isStorageConfigured } from './storage'

export interface ResolvedTheme {
  name: ThemeName
  module: (typeof themes)[ThemeName]
}

async function fetchActiveFromCache(siteId: string): Promise<string | null> {
  if (!isStorageConfigured()) return null
  let url: string
  try {
    url = publicAssetUrl(`public/site-settings/${siteId}.json`)
  } catch {
    return null
  }
  const res = await fetch(url, { next: { revalidate: 60, tags: [`site-settings:${siteId}`] } })
  if (!res.ok) return null
  const flat = (await res.json()) as Record<string, unknown>
  const v = flat['theme.active']
  return typeof v === 'string' ? v : null
}

/**
 * Resolve the active theme module for a site. Reads `theme.active` from
 * the S3 site-settings cache, validates it against the registry, and
 * falls back to `DEFAULT_THEME` for unknown / missing values.
 *
 * Different siteIds resolve independently, so multi-site deployments
 * can have completely different themes per subdomain / domain — that's
 * the whole point of the runtime-selectable model.
 */
export async function resolveActiveTheme(
  siteId: string = DEFAULT_SITE_ID
): Promise<ResolvedTheme> {
  const stored = await fetchActiveFromCache(siteId).catch(() => null)
  const name = (stored && stored in themes ? stored : DEFAULT_THEME) as ThemeName
  return { name, module: themes[name] }
}
