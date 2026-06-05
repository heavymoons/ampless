'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'aws-amplify/auth'
import {
  LayoutDashboard,
  FileText,
  Image,
  Globe,
  Users,
  Key,
  Puzzle,
  LogOut,
  ExternalLink,
  Menu,
  X,
} from 'lucide-react'
import { Button, cn } from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'
import { clearAllDrafts } from '../lib/post-draft.js'

interface NavItem {
  href: string
  key: string
  icon: typeof LayoutDashboard
  /** When true, only render for users in `ampless-admin`. */
  adminOnly?: true
}

const navItems: readonly NavItem[] = [
  { href: '/admin', key: 'sidebar.dashboard', icon: LayoutDashboard },
  { href: '/admin/posts', key: 'sidebar.posts', icon: FileText },
  { href: '/admin/media', key: 'sidebar.media', icon: Image },
  // ampless runs one site per deployment, so this links directly to
  // the single site's settings page instead of a list landing.
  { href: '/admin/sites/default', key: 'sidebar.sites', icon: Globe },
  { href: '/admin/plugins', key: 'sidebar.plugins', icon: Puzzle },
  { href: '/admin/users', key: 'sidebar.users', icon: Users, adminOnly: true },
  { href: '/admin/mcp-tokens', key: 'sidebar.mcpTokens', icon: Key, adminOnly: true },
] as const

export function Sidebar({
  email,
  isAdmin,
}: {
  email: string
  /** Gates `adminOnly` nav entries (user management). */
  isAdmin: boolean
}) {
  const pathname = usePathname()
  const t = useT()
  const [open, setOpen] = useState(false)

  // Auto-close the drawer on route change so a tap on a nav item on
  // mobile takes the user to the new page and gets out of the way.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Lock body scroll while the mobile drawer is open so the page behind
  // the overlay doesn't scroll under the user's thumb.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      {/* Mobile top bar — visible below md, hidden once the persistent
          rail takes over. Sticky so it stays in reach during long
          scrolling pages (post editor, media grid). */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <Link href="/admin" className="font-semibold">
          {t('sidebar.brand')}
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('sidebar.openMenu')}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </header>

      {/* Backdrop for the mobile drawer. Click outside closes the menu. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          // Mobile drawer overlays page content (`fixed` + `z-50`), so
          // it must be fully opaque to stay readable. The desktop rail
          // (`md:sticky`) sits in its own column with nothing behind it,
          // so the original subtle muted tint is fine there.
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-background transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 md:bg-muted/30',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
        aria-label={t('sidebar.brand')}
      >
        <div className="flex items-center justify-between border-b p-4">
          <Link href="/admin" className="font-semibold">
            {t('sidebar.brand')}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('sidebar.closeMenu')}
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {navItems.map((item) => {
            if (item.adminOnly && !isAdmin) return null
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
              // Clear per-browser recovery drafts so one user's unsaved
              // edits don't linger for the next person on a shared machine.
              clearAllDrafts()
              await signOut()
              window.location.href = '/login'
            }}
          >
            <LogOut className="h-4 w-4" />
            {t('sidebar.signOut')}
          </Button>
        </div>
      </aside>
    </>
  )
}
