import Link from 'next/link'

interface TagListProps {
  tags?: string[] | null
  className?: string
}

// Renders post tags as chip-style links to /tag/[tag]. Pure-server, no JS.
export function TagList({ tags, className }: TagListProps) {
  if (!tags?.length) return null
  return (
    <ul className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            href={`/tag/${encodeURIComponent(tag)}`}
            className="inline-block rounded-full border px-3 py-0.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  )
}
