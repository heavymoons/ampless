'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  /** Sidebar content — typically `<SiteSidebar ... />`. */
  children: React.ReactNode
  /** Label on the toggle button (mobile only). */
  label?: string
  className?: string
}

/**
 * Wraps a sidebar so it collapses on small screens behind a toggle
 * button, and stays open / sticky at `lg` and above. The wrapped
 * content can still be a server component (it's passed as children
 * and rendered as-is); only the toggle state lives client-side.
 *
 * Why not native `<details>`? Tailwind v4's `details` styling is
 * fine for the open/closed transition, but we want the *desktop*
 * presentation to ignore the toggle entirely — and forcing a details
 * element open via CSS while suppressing its summary cross-browser
 * is finicky. A small useState client component is simpler.
 */
export function CollapsibleSidebar({ children, label = 'Menu', className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border bg-[var(--card)] px-4 py-2 text-sm font-medium lg:hidden"
      >
        <span>{label}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      <div className={`mt-3 lg:mt-0 ${open ? 'block' : 'hidden'} lg:block`}>{children}</div>
    </div>
  )
}
