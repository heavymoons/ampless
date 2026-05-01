import Link from 'next/link'
import { parseLinkList, isTagListUrl } from 'ampless'

interface Props {
  /** JSON-stringified linkList from theme.values.<key>. */
  links: string | undefined
  brand?: React.ReactNode
  className?: string
}

/**
 * Theme-agnostic header that consumes a `linkList` value (JSON string
 * from a theme manifest field). Themes wrap this with their own
 * spacing / colors via `className` and supply the `brand` element.
 *
 * `tag:<name>` URLs are rendered as plain text (no link); for nav
 * sections that should expand into post lists, use SiteSidebar
 * instead — header isn't the place to render dozens of posts inline.
 */
export function SiteHeader({ links, brand, className }: Props) {
  const items = parseLinkList(links)
  return (
    <header className={`flex items-center justify-between border-b px-6 py-4 ${className ?? ''}`}>
      <div className="flex items-center gap-3 font-semibold">
        {brand ?? (
          <Link href="/" className="hover:text-[var(--primary)]">
            Home
          </Link>
        )}
      </div>
      {items.length > 0 && (
        <nav className="flex items-center gap-5 text-sm">
          {items.map((item, i) => {
            // Tag references collapse to a plain label in the header —
            // expanding them inline would blow out the chrome. Sidebars
            // are the right surface for tag-driven post lists.
            if (isTagListUrl(item.url)) {
              return (
                <span key={i} className="text-muted-foreground">
                  {item.label}
                </span>
              )
            }
            return (
              <Link
                key={i}
                href={item.url}
                className="text-foreground hover:text-[var(--primary)]"
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      )}
    </header>
  )
}
