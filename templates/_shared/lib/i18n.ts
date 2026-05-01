import en from '../locales/en.json'
import ja from '../locales/ja.json'
import cmsConfig from '@/cms.config'

// Locale registry. Adding a language is two steps:
//   1. Drop `locales/<code>.json` next to en.json / ja.json.
//   2. Add it here as `<code>: dictionaryImport`.
// The dictionary shape doesn't have to be exhaustive — missing keys
// fall back to English, then to the key string itself.
const dictionaries = { en, ja } as const

export type Locale = keyof typeof dictionaries
export type Dictionary = typeof en

export const SUPPORTED_LOCALES = Object.keys(dictionaries) as Locale[]
export const FALLBACK_LOCALE: Locale = 'en'

/**
 * Resolve the active locale for the admin app.
 *
 * Currently reads from `cms.config.ts` (`locale` field). Per-site
 * overrides via the `locale` site setting are planned but not wired
 * yet — a single deployment uses one admin language.
 */
export function getLocale(): Locale {
  const code = (cmsConfig as { locale?: string }).locale ?? 'ja'
  return code in dictionaries ? (code as Locale) : FALLBACK_LOCALE
}

export function getDictionary(locale: Locale = getLocale()): Dictionary {
  return dictionaries[locale]
}

/**
 * Walk a dotted key (`'admin.posts.title'`) through the dictionary.
 * Returns the leaf string if found, undefined otherwise.
 */
function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return typeof cur === 'string' ? cur : undefined
}

/**
 * Translate a key using the active dictionary, with `{var}` interpolation.
 * Falls back: requested dict → English dict → the key itself. The key
 * fallback makes missing translations visible in the UI rather than
 * silently rendering an empty string.
 */
export function translate(
  dict: Dictionary,
  key: string,
  vars?: Record<string, string | number>
): string {
  const value =
    lookup(dict, key) ?? lookup(dictionaries[FALLBACK_LOCALE], key) ?? key
  if (!vars) return value
  return value.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k]
    return v !== undefined ? String(v) : `{${k}}`
  })
}

/**
 * Server-side translation helper. For client components, prefer
 * `useT()` from `@/components/i18n-provider`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(getDictionary(), key, vars)
}
