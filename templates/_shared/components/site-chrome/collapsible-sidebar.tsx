'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

interface Props {
  /** Sidebar content — typically `<SiteSidebar ... />`. */
  children: React.ReactNode
  /** Label on the toggle button (mobile only). */
  label?: string
  className?: string
}

/**
 * Wraps a sidebar so it slides in from the left as a Sheet drawer on
 * small screens, and renders inline / sticky at `lg` and above. The
 * wrapped content can still be a server component (passed as children
 * and rendered as-is); only the open/closed toggle lives client-side.
 *
 * The children render twice — once inline (visible only at lg+) and
 * once inside the Sheet (mounted only when open, portaled to body) —
 * which is fine because they're already-evaluated React elements with
 * no per-instance state of their own.
 */
export function CollapsibleSidebar({ children, label = 'Menu', className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label={label}
          className="flex w-full items-center gap-2 rounded-md border bg-[var(--card)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent)] lg:hidden"
        >
          <Menu className="h-4 w-4" />
          <span>{label}</span>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-72 overflow-y-auto px-6 py-12"
          onClick={(e) => {
            // SiteSidebar is a server component, so we can't wrap each
            // Link in <SheetClose>. Detect anchor clicks via delegation
            // instead and close the sheet on navigation.
            if ((e.target as HTMLElement).closest('a')) setOpen(false)
          }}
        >
          {children}
        </SheetContent>
      </Sheet>
      <div className="hidden lg:block">{children}</div>
    </div>
  )
}
