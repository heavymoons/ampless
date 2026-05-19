import {
  DEFAULT_SITE_ID,
  resolveThemeValues,
  themeSettingKey,
  type ThemeManifest,
  type ThemeField,
} from 'ampless'
import type { StorageApi } from './storage.js'
import type { ThemeActiveApi } from './theme-active.js'

export type ColorScheme = 'auto' | 'light' | 'dark'

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'auto'

/**
 * Storage key for the per-site color-scheme override. Lives under the
 * same `theme.*` namespace as manifest fields so it flows through the
 * existing KvStore → S3 cache pipeline, but is read separately from
 * the manifest field set (it's a site-wide concern, not theme-specific).
 */
export const COLOR_SCHEME_SETTING_KEY = 'theme.colorScheme'

/**
 * Narrow an arbitrary stored value to a known `ColorScheme`. Anything
 * unrecognised (including `undefined`, malformed strings, accidental
 * objects) falls back to `'auto'` so a typo never strands a site
 * forced into a mode it can't undo.
 */
export function validateColorScheme(raw: unknown): ColorScheme {
  if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  return DEFAULT_COLOR_SCHEME
}

export interface EffectiveThemeConfig {
  /** Resolved active theme name (e.g. 'blog'). */
  activeTheme: string
  manifest: ThemeManifest
  /** Resolved values, keyed by manifest field key. Always populated. */
  values: Record<string, string>
  /** Subset of `values` for fields that have a `cssVar`. */
  cssVars: Record<string, string>
  /**
   * Per-site color-scheme override. `'auto'` (default) lets the
   * visitor's system `prefers-color-scheme` decide; `'light'` /
   * `'dark'` pin one mode regardless of system preference.
   *
   * Consumed by the root layout to set `<html data-color-scheme>`,
   * which the theme tokens.css files key off in combination with the
   * `light-dark()` CSS function.
   */
  colorScheme: ColorScheme
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
      // Color-scheme is site-wide, not part of the manifest, so it
      // reads from the flat map directly under a fixed key.
      const colorScheme = validateColorScheme(flat?.[COLOR_SCHEME_SETTING_KEY])
      return { activeTheme: active.name, manifest, values, cssVars, colorScheme }
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
