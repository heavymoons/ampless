'use client'

import { useState } from 'react'
import Link from 'next/link'
import { isTagListUrl, type LinkListItem } from 'ampless'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'

interface Props {
  items: LinkListItem[]
  className?: string
}

/**
 * Mobile nav for SiteHeader. Animated hamburger toggle that opens a
 * right-side Sheet drawer with the linkList. The button morphs from
 * three lines to an X via CSS transforms when the sheet is open. ESC,
 * overlay click, and link click all close the drawer.
 *
 * Tag references collapse to plain text — same rule as the desktop
 * header. Sidebars are the right surface for tag-driven post lists.
 */
export function MobileMenu({ items, className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Menu"
        className={`group relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--accent)] ${className ?? ''}`}
      >
        {/* Three lines that morph into an X. Radix sets `data-state`
            ("open" / "closed") on this trigger element; the spans
            below tap into it via `group-data-[state=open]:`. */}
        <span className="sr-only">Menu</span>
        <span aria-hidden className="block h-4 w-5 relative">
          <span className="absolute left-0 top-0 h-0.5 w-5 bg-current origin-center transition-transform duration-200 group-data-[state=open]:translate-y-[7px] group-data-[state=open]:rotate-45" />
          <span className="absolute left-0 top-1.5 h-0.5 w-5 bg-current transition-opacity duration-200 group-data-[state=open]:opacity-0" />
          <span className="absolute left-0 top-3 h-0.5 w-5 bg-current origin-center transition-transform duration-200 group-data-[state=open]:-translate-y-[7px] group-data-[state=open]:-rotate-45" />
        </span>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <nav className="flex flex-col gap-1 px-6 py-16 text-base">
          {items.map((item, i) => {
            if (isTagListUrl(item.url)) {
              return (
                <span
                  key={i}
                  className="px-2 py-3 text-muted-foreground"
                >
                  {item.label}
                </span>
              )
            }
            return (
              <SheetClose asChild key={i}>
                <Link
                  href={item.url}
                  className="rounded-md px-2 py-3 text-foreground hover:bg-[var(--accent)] hover:text-[var(--primary)]"
                >
                  {item.label}
                </Link>
              </SheetClose>
            )
          })}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
