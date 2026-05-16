// Admin i18n. Locale strings live in `src/locales/<code>.json` and
// ship with the package; consumers can override the active locale via
// `createAdmin({ locale: 'ja' })` (or by passing a plain dictionary
// object for ad-hoc overrides). Missing keys fall back to English, then
// to the key itself.

import en from '../locales/en.json'
import ja from '../locales/ja.json'

const dictionaries = { en, ja } as const

export type Locale = keyof typeof dictionaries
export type Dictionary = typeof en

export const SUPPORTED_LOCALES = Object.keys(dictionaries) as Locale[]
export const FALLBACK_LOCALE: Locale = 'en'

export type AdminLocaleStrings = Partial<Dictionary> & Record<string, unknown>

/**
 * Resolve the active locale from a `createAdmin` `locale` option.
 *
 * - `undefined` → fallback English.
 * - string code in `dictionaries` → that built-in dictionary.
 * - object → custom dictionary (no fallback merge here; lookups still
 *   fall back to English via `translate` if a key is missing).
 */
export interface ResolvedLocale {
  locale: Locale
  dict: Dictionary
}

export function resolveLocale(
  input: string | AdminLocaleStrings | undefined
): ResolvedLocale {
  if (!input) return { locale: FALLBACK_LOCALE, dict: dictionaries[FALLBACK_LOCALE] }
  if (typeof input === 'string') {
    if (input in dictionaries) {
      return { locale: input as Locale, dict: dictionaries[input as Locale] }
    }
    return { locale: FALLBACK_LOCALE, dict: dictionaries[FALLBACK_LOCALE] }
  }
  // Custom dictionary object — tag as "en" for `<html lang>` purposes
  // (overrideable by spreading `lang: '...'` if needed later).
  return { locale: FALLBACK_LOCALE, dict: input as Dictionary }
}

export function getDictionary(locale: Locale = FALLBACK_LOCALE): Dictionary {
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
 * Translate a key using the given dictionary, with `{var}` interpolation.
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
