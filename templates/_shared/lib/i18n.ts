// Back-compat shim. Admin i18n moved to `@ampless/admin` (L2
// extraction). The dictionary is bound at admin-factory time in
// `lib/admin.ts`; this file keeps the existing call sites (`t(...)`,
// `getLocale()`, `getDictionary()`) working.
//
// New code should use `admin.t` (from `@/lib/admin`) or the client-side
// `useT()` (from `@/components/i18n-provider`).

import { admin } from './admin'
import { getDictionary as adminGetDictionary, type Dictionary, type Locale } from '@ampless/admin'

export type { Dictionary, Locale }
export const FALLBACK_LOCALE: Locale = 'en'

export function getLocale(): Locale {
  return admin.locale
}

export function getDictionary(locale: Locale = admin.locale): Dictionary {
  return adminGetDictionary(locale)
}

export const t = admin.t

export function translate(
  _dict: Dictionary,
  key: string,
  vars?: Record<string, string | number>
): string {
  return admin.t(key, vars)
}
