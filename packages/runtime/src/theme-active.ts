import { headers } from 'next/headers'
import { type ThemeModule } from 'ampless'
import type { StorageApi } from './storage.js'
import { PREVIEW_THEME_HEADER } from './request-headers.js'

export interface ThemesRegistry {
  /** Map of theme name → loaded theme module. */
  themes: Record<string, ThemeModule>
  /** Name used when no `theme.active` override is stored. */
  defaultTheme: string
}

export interface ResolvedTheme {
  name: string
  module: ThemeModule
}

export interface ThemeActiveApi {
  resolveActiveTheme(): Promise<ResolvedTheme>
  /**
   * Read the stored `theme.active` value directly from the S3 cache
   * with `cache: 'no-store'` — bypassing Next.js's fetch cache and
   * any tag-based revalidation. Returns the raw stored name (which
   * may be a theme that isn't in the registry) or `null` when the
   * S3 file is missing / unreadable.
   *
   * Used by the admin theme-switch flow to poll until the trusted
   * processor has propagated a KvStore write to S3, so the post-
   * switch hard reload doesn't race the cache rebuild.
   */
  readStoredActiveThemeFresh(): Promise<string | null>
}

export function createThemeActive(
  registry: ThemesRegistry,
  storage: StorageApi
): ThemeActiveApi {
  function settingsUrl(): string | null {
    if (!storage.isStorageConfigured()) return null
    try {
      return storage.publicAssetUrl('public/site-settings.json')
    } catch {
      return null
    }
  }

  async function fetchActiveFromCache(): Promise<string | null> {
    const url = settingsUrl()
    if (!url) return null
    const res = await fetch(url, {
      next: { revalidate: 60, tags: ['site-settings'] },
    })
    if (!res.ok) return null
    const flat = (await res.json()) as Record<string, unknown>
    const v = flat['theme.active']
    return typeof v === 'string' ? v : null
  }

  async function fetchActiveFresh(): Promise<string | null> {
    const url = settingsUrl()
    if (!url) return null
    const res = await fetch(url, { cache: 'no-store' })
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
    readStoredActiveThemeFresh: () => fetchActiveFresh(),

    async resolveActiveTheme(): Promise<ResolvedTheme> {
      // Try to read the preview override from the request headers. Wrapped
      // in try/catch so non-request contexts (e.g. event handlers) don't
      // crash; they just skip the override.
      let previewOverride: string | null = null
      try {
        const h = await headers()
        previewOverride = h.get(PREVIEW_THEME_HEADER)
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
