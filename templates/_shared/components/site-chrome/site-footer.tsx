import Link from 'next/link'
import { parseLinkList, isTagListUrl } from 'ampless'

interface Props {
  links: string | undefined
  /** Optional below-links text (copyright, tagline). */
  legend?: React.ReactNode
  className?: string
}

/**
 * Theme-agnostic footer rendering a `linkList` plus optional legend
 * below. Same tag: handling rule as the header — collapse to plain
 * text rather than blow out the chrome with post lists.
 */
export function SiteFooter({ links, legend, className }: Props) {
  const items = parseLinkList(links)
  return (
    <footer className={`border-t px-6 py-8 ${className ?? ''}`}>
      <div className="mx-auto max-w-5xl space-y-4">
        {items.length > 0 && (
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {items.map((item, i) => {
              if (isTagListUrl(item.url)) {
                return <span key={i}>{item.label}</span>
              }
              return (
                <Link
                  key={i}
                  href={item.url}
                  className="hover:text-[var(--primary)]"
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}
        {legend && <div className="text-xs text-muted-foreground">{legend}</div>}
      </div>
    </footer>
  )
}
