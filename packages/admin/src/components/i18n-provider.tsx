'use client'

import { createContext, useContext, useMemo } from 'react'
import { translate, type Dictionary, type Locale } from '../lib/i18n.js'

interface I18nContextValue {
  locale: Locale
  dict: Dictionary
}

const I18nContext = createContext<I18nContextValue | null>(null)

interface ProviderProps {
  locale: Locale
  /**
   * Pass the dictionary as plain JSON via props. Server resolves it in
   * the admin layout and threads it through, so the client bundle
   * doesn't need to import every locale eagerly.
   */
  dict: Dictionary
  children: React.ReactNode
}

export function I18nProvider({ locale, dict, children }: ProviderProps) {
  const value = useMemo(() => ({ locale, dict }), [locale, dict])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/**
 * Client-side translation hook. For server components, prefer
 * `admin.t(...)` from the createAdmin instance.
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error(
      'useT() called outside <I18nProvider>. Wrap the admin layout (or root layout) with <I18nProvider locale={...} dict={...}>.'
    )
  }
  return (key, vars) => translate(ctx.dict, key, vars)
}

/** Read the active locale from context (e.g. for `<html lang>` parity). */
export function useLocale(): Locale {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useLocale() called outside <I18nProvider>.')
  return ctx.locale
}
