'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { isTagListUrl, type LinkListItem } from 'ampless'

interface Props {
  items: LinkListItem[]
  className?: string
}

/**
 * Mobile menu toggle for SiteHeader. Hamburger icon + click-to-open
 * dropdown panel that overlays below the header. Desktop renders the
 * regular `<nav>` directly; this component is gated to `md:hidden` by
 * the parent.
 *
 * Closes on link click so navigation feels immediate. Tag references
 * collapse to plain text — same rule as the desktop header.
 */
export function MobileMenu({ items, className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-[var(--accent)]"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 border-b bg-[var(--background)] shadow-md">
          <nav className="flex flex-col gap-1 px-6 py-4 text-sm">
            {items.map((item, i) => {
              if (isTagListUrl(item.url)) {
                return (
                  <span
                    key={i}
                    className="px-2 py-2 text-muted-foreground"
                  >
                    {item.label}
                  </span>
                )
              }
              return (
                <Link
                  key={i}
                  href={item.url}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2 text-foreground hover:bg-[var(--accent)] hover:text-[var(--primary)]"
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </div>
  )
}
