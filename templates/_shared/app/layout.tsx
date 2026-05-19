import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { DEFAULT_SITE_ID } from 'ampless'
import { Providers } from './providers'
import { siteMetadata } from '@/lib/seo'
import { loadThemeConfig, renderThemeCss } from '@/lib/theme-config'
import { getLocale, getDictionary } from '@/lib/i18n'
import { I18nProvider } from '@/components/i18n-provider'
import './globals.css'

// Resolve metadata per site at request time. The middleware sets
// `x-site-id` so we can pick the right merged settings; falls back to
// DEFAULT_SITE_ID for admin / API routes that don't go through the
// public middleware path.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const siteId = h.get('x-site-id') ?? DEFAULT_SITE_ID
  return siteMetadata(siteId)
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const siteId = h.get('x-site-id') ?? DEFAULT_SITE_ID
  const theme = await loadThemeConfig(siteId)
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
  const htmlProps: { lang: string; 'data-color-scheme'?: 'light' | 'dark' } = { lang: locale }
  if (theme.colorScheme !== 'auto') {
    htmlProps['data-color-scheme'] = theme.colorScheme
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
