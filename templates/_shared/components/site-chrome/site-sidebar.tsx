import Link from 'next/link'
import { parseLinkList, isTagListUrl } from 'ampless'
import { ampless } from '@/lib/ampless'

interface Props {
  links: string | undefined
  className?: string
}

/**
 * Sidebar nav with tag expansion. For docs-style sites: a `linkList`
 * entry whose URL is `tag:<name>` is rendered as a labelled section
 * with every published post tagged `<name>` listed underneath. Plain
 * URLs render as a single link in the same flat list.
 *
 * Each tag: entry triggers one AppSync query. With ~10 tag sections
 * in a sidebar that's 10 queries per render; revalidation should be
 * paired with `force-dynamic` on the page so fresh content shows up
 * after publish events.
 */
export async function SiteSidebar({ links, className }: Props) {
  const items = parseLinkList(links)
  if (items.length === 0) return null

  // Resolve tag: entries up front so we render after all data is in.
  const sections = await Promise.all(
    items.map(async (item) => {
      const tagRef = isTagListUrl(item.url)
      if (!tagRef) return { type: 'link' as const, label: item.label, url: item.url }
      const { items: posts } = await ampless.listPostsByTag(tagRef.tag, { limit: 50 })
      return {
        type: 'tagSection' as const,
        label: item.label,
        tag: tagRef.tag,
        posts: posts.map((p) => ({ slug: p.slug, title: p.title })),
      }
    })
  )

  return (
    <aside className={`space-y-6 ${className ?? ''}`}>
      {sections.map((section, i) => {
        if (section.type === 'link') {
          return (
            <Link
              key={i}
              href={section.url}
              className="block text-sm font-medium hover:text-[var(--primary)]"
            >
              {section.label}
            </Link>
          )
        }
        return (
          <div key={i}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </p>
            <ul className="space-y-1">
              {section.posts.length === 0 ? (
                <li className="text-xs text-muted-foreground">No posts.</li>
              ) : (
                section.posts.map((post) => (
                  <li key={post.slug}>
                    <Link
                      href={`/${post.slug}`}
                      className="block text-sm text-foreground hover:text-[var(--primary)]"
                    >
                      {post.title}
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        )
      })}
    </aside>
  )
}
