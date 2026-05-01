// Theme customization manifest.
//
// Each scaffolded project ships a `theme.manifest.ts` (overlaid by the
// theme it was scaffolded from) declaring which fields the admin UI
// should expose. Different themes can expose different fields — a
// minimal theme might only allow color tweaks, a richer theme might
// expose logo / hero image / per-section typography.
//
// Override values are stored in KvStore under
//   PK = `siteconfig:{siteId}`, SK = `theme.{field.key}`
// and propagated to the public site through the normal site-settings
// S3 cache. See docs/THEMES.md for authoring details.

export type ThemeFieldType =
  | 'color'
  | 'text'
  | 'select'
  | 'image'
  | 'length'
  | 'fontFamily'

interface ThemeFieldBase {
  /** Storage key. Persisted as `theme.{key}` in site settings. */
  key: string
  label: string
  description?: string
  /** Optional UI grouping (e.g. 'Colors', 'Typography', 'Branding'). */
  group?: string
  /** Used when no override is set. Always a string for storage uniformity. */
  default: string
  /**
   * If set, the loader injects `${cssVar}: ${value}` into a `:root`
   * style block on every public page, so CSS rules using
   * `var(${cssVar})` pick up overrides at render time.
   *
   * Fields without `cssVar` (e.g. logo URL, header tagline) are exposed
   * to template code via `loadThemeConfig()` instead.
   */
  cssVar?: string
}

export interface ThemeColorField extends ThemeFieldBase {
  type: 'color'
}

export interface ThemeTextField extends ThemeFieldBase {
  type: 'text'
  maxLength?: number
}

export interface ThemeSelectField extends ThemeFieldBase {
  type: 'select'
  options: ReadonlyArray<{ value: string; label: string }>
}

export interface ThemeImageField extends ThemeFieldBase {
  type: 'image'
}

export interface ThemeLengthField extends ThemeFieldBase {
  type: 'length'
}

export interface ThemeFontFamilyField extends ThemeFieldBase {
  type: 'fontFamily'
  options: ReadonlyArray<{ value: string; label: string }>
}

export type ThemeField =
  | ThemeColorField
  | ThemeTextField
  | ThemeSelectField
  | ThemeImageField
  | ThemeLengthField
  | ThemeFontFamilyField

export interface ThemeManifest {
  /** Theme directory name (`templates/<name>/`). */
  name: string
  label: string
  description?: string
  fields: ReadonlyArray<ThemeField>
}

export function defineTheme(m: ThemeManifest): ThemeManifest {
  return m
}

/**
 * Storage key used in KvStore. Prefix `theme.` keeps the namespace
 * separate from `site.*` / `media.*` so unrelated tools can scan
 * settings without colliding.
 */
export function themeSettingKey(fieldKey: string): string {
  return `theme.${fieldKey}`
}

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\))$/
const LENGTH_RE = /^[\d.]+(px|rem|em|%|vh|vw)$/
const IMAGE_URL_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/

/**
 * Reject malformed or potentially-injectable values before they reach
 * the KvStore. Admin/editor are trusted but typos and copy-paste
 * mistakes shouldn't be able to break a site's CSS or sneak `</style>`
 * into the inline tag the loader emits.
 *
 * Returns the normalized value, or null if the input is rejected.
 */
export function validateThemeValue(field: ThemeField, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  switch (field.type) {
    case 'color':
      return COLOR_RE.test(v) ? v : null
    case 'length':
      return LENGTH_RE.test(v) ? v : null
    case 'image':
      return IMAGE_URL_RE.test(v) ? v : null
    case 'select':
    case 'fontFamily':
      return field.options.some((o) => o.value === v) ? v : null
    case 'text': {
      const max = (field as ThemeTextField).maxLength ?? 200
      // Strip control chars + angle brackets so values inserted into HTML
      // attributes / inline styles can't escape their context.
      const sanitized = v.replace(/[\x00-\x1f<>]/g, '')
      return sanitized.length <= max ? sanitized : sanitized.slice(0, max)
    }
  }
}

/**
 * Resolve effective values for every manifest field, merging stored
 * overrides on top of defaults. `stored` is the flat settings map keyed
 * by `theme.{key}` — typically the output of `listSiteSettings(siteId)`
 * filtered to theme entries.
 */
export function resolveThemeValues(
  manifest: ThemeManifest,
  stored: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of manifest.fields) {
    const storeKey = themeSettingKey(field.key)
    const raw = stored[storeKey]
    const validated = raw !== undefined ? validateThemeValue(field, raw) : null
    out[field.key] = validated ?? field.default
  }
  return out
}
