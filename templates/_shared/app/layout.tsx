import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { renderThemeCss, validateColorScheme } from '@ampless/runtime'
import { getDictionary } from '@ampless/admin'
import { I18nProvider } from '@ampless/admin/components'
import { ampless } from '@/lib/ampless'
import { admin } from '@/lib/admin'
import { Providers } from './providers'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  return ampless.siteMetadata()
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  // Resolve theme, plugin head + body in parallel. `publicHead` and
  // `publicBodyEnd` both fetch the S3 site-settings cache to bind
  // `ctx.setting()`; Next.js fetch dedupe collapses that into a
  // single round trip when the two run on the same request.
  const [theme, pluginHead, pluginBodyEnd] = await Promise.all([
    ampless.loadThemeConfig(),
    ampless.publicHead(),
    ampless.publicBodyEnd(),
  ])
  const themeCss = renderThemeCss(theme.cssVars)
  const locale = admin.locale
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
        {/* Descriptor-based plugin head injection (Phase 1+2). Each
            active plugin's `publicHead()` runs validation here; the
            output is a `<Fragment>` of `<script>` / `<meta>` / `<link>`
            / `<noscript>` elements. Placed after the theme style so
            plugin-emitted overrides win on the rare collision.
            Awaited via Promise.all above so admin-managed
            `settings.public` values flow into ctx.setting() before
            render. */}
        {pluginHead}
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
        {/* Descriptor-based body-end injection (Phase 1+2). GTM
            no-script iframe / chat widgets / analytics tail snippets
            land here. Awaited above so the same ctx.setting()
            snapshot powers both head + body. */}
        {pluginBodyEnd}
      </body>
    </html>
  )
}
