import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { validateColorScheme } from '@ampless/runtime'
import { Providers } from './providers'
import { siteMetadata } from '@/lib/seo'
import { loadThemeConfig, renderThemeCss } from '@/lib/theme-config'
import { getLocale, getDictionary } from '@/lib/i18n'
import { I18nProvider } from '@/components/i18n-provider'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata()
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const theme = await loadThemeConfig()
  const themeCss = renderThemeCss(theme.cssVars)
  const locale = getLocale()
  const dict = getDictionary(locale)
  // `data-color-scheme` pins the visitor to light or dark regardless
  // of their system `prefers-color-scheme`. `'auto'` (the default)
  // means we don't emit the attribute at all, so `globals.css`'s
  // `:root { color-scheme: light dark }` lets the browser follow the
  // system setting. Themes use `light-dark()` in their tokens.css so a
  // single declaration covers both modes; the active `color-scheme`
  // selects which value is rendered.
  //
  // The admin's theme-settings iframe preview passes the unsaved
  // selection via `?previewColorScheme=<mode>`, which middleware
  // forwards as `x-preview-color-scheme`. When that header is present
  // it overrides the stored site setting so the preview updates live.
  const previewHeader = h.get('x-preview-color-scheme')
  const effectiveColorScheme = previewHeader
    ? validateColorScheme(previewHeader)
    : theme.colorScheme
  const htmlProps: { lang: string; 'data-color-scheme'?: 'light' | 'dark' } = { lang: locale }
  if (effectiveColorScheme !== 'auto') {
    htmlProps['data-color-scheme'] = effectiveColorScheme
  }
  return (
    <html {...htmlProps}>
      <head>
        {/* Inline `:root` overrides come AFTER globals.css so they win
            against the static defaults. Validated values only — see
            ampless `validateThemeValue`. */}
        {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
      </head>
      {/* `data-theme` selects which theme's `tokens.css` block matches.
          The active theme is resolved from `theme.active` site setting,
          falling back to DEFAULT_THEME — see `resolveActiveTheme`. */}
      <body className="min-h-screen" data-theme={theme.activeTheme}>
        <Providers>
          <I18nProvider locale={locale} dict={dict}>
            {children}
          </I18nProvider>
        </Providers>
      </body>
    </html>
  )
}
