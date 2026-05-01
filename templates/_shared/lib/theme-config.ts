import {
  DEFAULT_SITE_ID,
  resolveThemeValues,
  themeSettingKey,
  type ThemeManifest,
  type ThemeField,
} from 'ampless'
import themeManifest from '@/theme.manifest'
import { publicAssetUrl, isStorageConfigured } from './storage'

export interface EffectiveThemeConfig {
  manifest: ThemeManifest
  /** Resolved values, keyed by manifest field key. Always populated. */
  values: Record<string, string>
  /** Subset of `values` for fields that have a `cssVar`. */
  cssVars: Record<string, string>
}

async function fetchRemote(siteId: string): Promise<Record<string, unknown> | null> {
  if (!isStorageConfigured()) return null
  let url: string
  try {
    url = publicAssetUrl(`public/site-settings/${siteId}.json`)
  } catch {
    return null
  }
  // Same cache contract as `loadSiteSettings` — 60s S3 + Next.js fetch
  // dedupe per-request. Theme overrides land in the same JSON.
  const res = await fetch(url, { next: { revalidate: 60, tags: [`site-settings:${siteId}`] } })
  if (!res.ok) return null
  // The cache file is flat (`{ 'theme.primary': '...', 'site.name': '...' }`),
  // so we can read it directly without unflattening.
  return (await res.json()) as Record<string, unknown>
}

/**
 * Resolve effective theme config for a site. Merges:
 *   1. KvStore-backed `theme.*` overrides (from S3 cache)
 *   2. manifest field defaults
 *
 * Stored values that fail validation (malformed colors, lengths,
 * unrecognized select options) are silently dropped and fall back to
 * the manifest default — keeping a typo from breaking the public site.
 */
export async function loadThemeConfig(
  siteId: string = DEFAULT_SITE_ID
): Promise<EffectiveThemeConfig> {
  const flat = await fetchRemote(siteId).catch(() => null)
  const stored: Record<string, unknown> = {}
  if (flat) {
    for (const field of themeManifest.fields) {
      const k = themeSettingKey(field.key)
      if (k in flat) stored[k] = flat[k]
    }
  }
  const values = resolveThemeValues(themeManifest, stored)
  const cssVars = collectCssVars(themeManifest.fields, values)
  return { manifest: themeManifest, values, cssVars }
}

function collectCssVars(
  fields: ReadonlyArray<ThemeField>,
  values: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) {
    if (!field.cssVar) continue
    const v = values[field.key]
    if (v) out[field.cssVar] = v
  }
  return out
}

/**
 * Render `cssVars` as the body of a `:root { ... }` CSS block. Values
 * have already been validated by `resolveThemeValues`, so the output is
 * safe to inline via `dangerouslySetInnerHTML`.
 */
export function renderThemeCss(cssVars: Record<string, string>): string {
  const lines = Object.entries(cssVars).map(([name, value]) => `  ${name}: ${value};`)
  if (lines.length === 0) return ''
  return `:root {\n${lines.join('\n')}\n}`
}
