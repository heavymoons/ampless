import { headers } from 'next/headers'
import { DEFAULT_SITE_ID, type ThemeModule } from 'ampless'
import type { StorageApi } from './storage.js'

export interface ThemesRegistry {
  /** Map of theme name → loaded theme module. */
  themes: Record<string, ThemeModule>
  /** Name used when no `theme.active` override is stored for the site. */
  defaultTheme: string
}

export interface ResolvedTheme {
  name: string
  module: ThemeModule
}

export interface ThemeActiveApi {
  /**
   * `siteId` is accepted for API compatibility but ignored — ampless
   * runs one site per Amplify deployment, so the active theme is a
   * single global value keyed by `DEFAULT_SITE_ID`.
   */
  resolveActiveTheme(siteId?: string): Promise<ResolvedTheme>
}

export function createThemeActive(
  registry: ThemesRegistry,
  storage: StorageApi
): ThemeActiveApi {
  async function fetchActiveFromCache(): Promise<string | null> {
    if (!storage.isStorageConfigured()) return null
    let url: string
    try {
      url = storage.publicAssetUrl(`public/site-settings/${DEFAULT_SITE_ID}.json`)
    } catch {
      return null
    }
    const res = await fetch(url, {
      next: { revalidate: 60, tags: [`site-settings:${DEFAULT_SITE_ID}`] },
    })
    if (!res.ok) return null
    const flat = (await res.json()) as Record<string, unknown>
    const v = flat['theme.active']
    return typeof v === 'string' ? v : null
  }

  /**
   * Resolve the active theme module. Reads `theme.active` from the S3
   * site-settings cache, validates it against the registry, and falls
   * back to `defaultTheme` for unknown / missing values.
   *
   * Preview override: when the request carries an `x-preview-theme`
   * header (set by middleware from the `?previewTheme=<name>` query
   * param), that wins over the saved active theme. Used by the admin
   * theme settings page to render a live iframe of any installed
   * theme without committing the switch.
   */
  return {
    async resolveActiveTheme(): Promise<ResolvedTheme> {
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
      if (previewOverride && previewOverride in registry.themes) {
        const mod = registry.themes[previewOverride]
        if (mod) return { name: previewOverride, module: mod }
      }

      const stored = await fetchActiveFromCache().catch(() => null)
      const name = stored && stored in registry.themes ? stored : registry.defaultTheme
      const mod = registry.themes[name] ?? registry.themes[registry.defaultTheme]
      if (!mod) {
        throw new Error(
          `themes registry is empty — at least one theme must be registered before resolveActiveTheme is called`
        )
      }
      return { name, module: mod }
    },
  }
}
