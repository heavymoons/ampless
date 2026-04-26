import type { Metadata } from 'next'
import cmsConfig from '@/cms.config'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: cmsConfig.site.name,
  description: cmsConfig.site.description,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
