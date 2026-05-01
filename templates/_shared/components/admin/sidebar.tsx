'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'aws-amplify/auth'
import { LayoutDashboard, FileText, Image, Globe, LogOut, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useT } from '@/components/i18n-provider'

const navItems = [
  { href: '/admin', key: 'sidebar.dashboard', icon: LayoutDashboard },
  { href: '/admin/posts', key: 'sidebar.posts', icon: FileText },
  { href: '/admin/media', key: 'sidebar.media', icon: Image },
  { href: '/admin/sites', key: 'sidebar.sites', icon: Globe },
] as const

export function Sidebar({
  email,
  siteSelector,
}: {
  email: string
  /** Rendered above the main nav in multi-site mode. */
  siteSelector?: React.ReactNode
}) {
  const pathname = usePathname()
  const t = useT()

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-muted/30">
      <div className="border-b p-4">
        <Link href="/admin" className="font-semibold">
          {t('sidebar.brand')}
        </Link>
      </div>

      {siteSelector ? <div className="border-b">{siteSelector}</div> : null}

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || (item.href !== '/admin' && pathname?.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.key)}
            </Link>
          )
        })}
      </nav>

      <div className="border-t p-2 space-y-1">
        <Link
          href="/"
          target="_blank"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          {t('sidebar.viewSite')}
        </Link>
        <div className="px-3 py-2 text-xs text-muted-foreground truncate">{email}</div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3"
          onClick={async () => {
            await signOut()
            window.location.href = '/login'
          }}
        >
          <LogOut className="h-4 w-4" />
          {t('sidebar.signOut')}
        </Button>
      </div>
    </aside>
  )
}
