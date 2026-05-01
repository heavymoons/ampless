import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { DEFAULT_SITE_ID } from 'ampless'
import { Providers } from './providers'
import { siteMetadata } from '@/lib/seo'
import { loadThemeConfig, renderThemeCss } from '@/lib/theme-config'
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
  return (
    <html lang="en">
      <head>
        {/* Inline `:root` overrides come AFTER globals.css so they win
            against the static defaults. Validated values only — see
            ampless `validateThemeValue`. */}
        {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
