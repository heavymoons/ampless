import Link from 'next/link'

interface TagListProps {
  tags?: string[] | null
  className?: string
  /** Cap the number of tags shown; the rest collapse into a "+N" indicator. */
  max?: number
}

// Renders post tags as chip-style links to /tag/[tag]. Pure-server, no JS.
export function TagList({ tags, className, max }: TagListProps) {
  if (!tags?.length) return null
  const shown = max != null ? tags.slice(0, max) : tags
  const overflow = tags.length - shown.length
  return (
    <ul className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      {shown.map((tag) => (
        <li key={tag}>
          <Link
            href={`/tag/${encodeURIComponent(tag)}`}
            className="inline-block rounded-full border px-3 py-0.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            #{tag}
          </Link>
        </li>
      ))}
      {overflow > 0 && (
        <li className="inline-block px-2 py-0.5 text-xs text-muted-foreground">+{overflow}</li>
      )}
    </ul>
  )
}
