import Link from 'next/link'
import { parseLinkList, isTagListUrl } from 'ampless'
import { MobileMenu } from './mobile-menu'

interface Props {
  /** JSON-stringified linkList from theme.values.<key>. */
  links: string | undefined
  /** Optional logo image URL. When set, rendered as an <img>; the
   *  siteName is used as alt text. Empty falls back to siteName text. */
  logoUrl?: string
  /** Site name. Used as the brand text when no logo, and as alt
   *  text on the logo image. */
  siteName?: string
  /** Tailwind classes for the brand text wrapper (only when no logo). */
  brandClassName?: string
  /** Tailwind classes for the logo `<img>`. Defaults to a 32px-tall
   *  auto-width sizing — themes can override for taller / specific
   *  branding placements. */
  logoClassName?: string
  className?: string
}

/**
 * Theme-agnostic header that consumes a `linkList` value (JSON string
 * from a theme manifest field). Renders a logo image when `logoUrl`
 * is set; otherwise shows `siteName` text. Themes pick the brand
 * styling (font size / weight) via `brandClassName` so each theme can
 * keep its own typographic identity.
 *
 * Responsive: the regular `<nav>` is hidden below `md` and replaced
 * by a hamburger toggle (MobileMenu) that drops a panel overlay below
 * the header.
 *
 * `tag:<name>` URLs in the link list collapse to plain text — header
 * isn't the right surface for inline post lists; use SiteSidebar for
 * tag-driven nav.
 */
export function SiteHeader({
  links,
  logoUrl,
  siteName,
  brandClassName,
  logoClassName = 'h-8 w-auto',
  className,
}: Props) {
  const items = parseLinkList(links)
  const trimmedLogo = logoUrl?.trim()
  return (
    <header
      className={`relative flex items-center justify-between border-b px-6 py-4 ${className ?? ''}`}
    >
      <Link
        href="/"
        className={
          trimmedLogo
            ? 'inline-flex items-center'
            : (brandClassName ?? 'font-semibold hover:text-[var(--primary)]')
        }
      >
        {trimmedLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={trimmedLogo} alt={siteName ?? ''} className={logoClassName} />
        ) : (
          (siteName ?? 'Home')
        )}
      </Link>
      {items.length > 0 && (
        <>
          <nav className="hidden items-center gap-5 text-sm md:flex">
            {items.map((item, i) => {
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
          <MobileMenu items={items} className="md:hidden" />
        </>
      )}
    </header>
  )
}
