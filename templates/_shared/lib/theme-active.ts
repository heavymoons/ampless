import { headers } from 'next/headers'
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
 *
 * Preview override: when the request carries an `x-preview-theme`
 * header (set by middleware from the `?previewTheme=<name>` query
 * param), that wins over the saved active theme. Used by the admin
 * theme settings page to render a live iframe of any installed
 * theme without committing the switch.
 */
export async function resolveActiveTheme(
  siteId: string = DEFAULT_SITE_ID
): Promise<ResolvedTheme> {
  // Try to read the preview override from the request headers. Wrapped
  // in try/catch so non-request contexts (e.g. event handlers) don't
  // crash; they just skip the override.
  let previewOverride: string | null = null
  try {
    const h = await headers()
    previewOverride = h.get('x-preview-theme')
  } catch {
    // headers() is unavailable outside a request scope. Ignore.
  }
  if (previewOverride && previewOverride in themes) {
    const name = previewOverride as ThemeName
    return { name, module: themes[name] }
  }

  const stored = await fetchActiveFromCache(siteId).catch(() => null)
  const name = (stored && stored in themes ? stored : DEFAULT_THEME) as ThemeName
  return { name, module: themes[name] }
}
