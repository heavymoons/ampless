import {
  DEFAULT_SITE_ID,
  resolveThemeValues,
  themeSettingKey,
  type ThemeManifest,
  type ThemeField,
} from 'ampless'
import type { StorageApi } from './storage.js'
import type { ThemeActiveApi } from './theme-active.js'

export interface EffectiveThemeConfig {
  /** Resolved active theme name (e.g. 'blog'). */
  activeTheme: string
  manifest: ThemeManifest
  /** Resolved values, keyed by manifest field key. Always populated. */
  values: Record<string, string>
  /** Subset of `values` for fields that have a `cssVar`. */
  cssVars: Record<string, string>
}

export interface ThemeConfigApi {
  loadThemeConfig(siteId?: string): Promise<EffectiveThemeConfig>
}

export function createThemeConfig(
  themeActive: ThemeActiveApi,
  storage: StorageApi
): ThemeConfigApi {
  async function fetchRemote(siteId: string): Promise<Record<string, unknown> | null> {
    if (!storage.isStorageConfigured()) return null
    let url: string
    try {
      url = storage.publicAssetUrl(`public/site-settings/${siteId}.json`)
    } catch {
      return null
    }
    const res = await fetch(url, { next: { revalidate: 60, tags: [`site-settings:${siteId}`] } })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  }

  /**
   * Resolve effective theme config for a site:
   *   1. Active theme = `theme.active` setting (per-site) ?? defaultTheme
   *   2. Manifest = the active theme's manifest
   *   3. Values = stored `theme.<key>` overrides merged onto manifest defaults
   *
   * Stored values that fail validation (malformed colors, lengths,
   * unrecognized select options) are silently dropped and fall back to
   * the manifest default — keeping a typo from breaking the public site.
   */
  return {
    async loadThemeConfig(siteId: string = DEFAULT_SITE_ID): Promise<EffectiveThemeConfig> {
      const [active, flat] = await Promise.all([
        themeActive.resolveActiveTheme(siteId),
        fetchRemote(siteId).catch(() => null),
      ])
      const manifest = active.module.manifest
      const stored: Record<string, unknown> = {}
      if (flat) {
        for (const field of manifest.fields) {
          const k = themeSettingKey(field.key)
          if (k in flat) stored[k] = flat[k]
        }
      }
      const values = resolveThemeValues(manifest, stored)
      const cssVars = collectCssVars(manifest.fields, values)
      return { activeTheme: active.name, manifest, values, cssVars }
    },
  }
}

function collectCssVars(
  fields: ReadonlyArray<ThemeField>,
  values: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) {
    // linkList fields are JSON arrays consumed by template code, not
    // CSS — they don't have a cssVar at all. Skip via type guard.
    if (field.type === 'linkList') continue
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
