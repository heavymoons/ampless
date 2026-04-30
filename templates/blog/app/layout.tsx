import type { Metadata } from 'next'
import { Providers } from './providers'
import { siteMetadata } from '@/lib/seo'
import './globals.css'

export const metadata: Metadata = siteMetadata()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
