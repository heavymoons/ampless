import type { PostSummary } from './core.js'

export type PostListStatusFilter = 'all' | 'draft' | 'published'

export type PostListSort =
  | 'updated-desc'
  | 'updated-asc'
  | 'published-desc'
  | 'published-asc'
  | 'title-asc'
  | 'title-desc'

export interface PostListFilterOptions {
  query?: string
  status?: PostListStatusFilter
  tag?: string
  sort?: PostListSort
}

export function filterSortPostSummaries<T extends PostSummary>(
  rows: readonly T[],
  options: PostListFilterOptions = {}
): T[] {
  const query = options.query?.trim().toLowerCase() ?? ''
  const status = options.status ?? 'all'
  const tag = options.tag ?? ''
  const sort = options.sort ?? 'updated-desc'

  return rows
    .filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (tag && !row.tags.includes(tag)) return false
      if (!query) return true

      return (
        row.title.toLowerCase().includes(query) ||
        row.slug.toLowerCase().includes(query) ||
        row.tags.some((t) => t.toLowerCase().includes(query))
      )
    })
    .sort((a, b) => compareRows(a, b, sort))
}

export function collectTags(rows: readonly PostSummary[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of row.tags) {
      const trimmed = tag.trim()
      if (!trimmed) continue
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
    }
  }
  return new Map([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function compareRows(a: PostSummary, b: PostSummary, sort: PostListSort): number {
  switch (sort) {
    case 'updated-asc':
      return compareOptionalIso(a.updatedAt, b.updatedAt, 'asc')
    case 'updated-desc':
      return compareOptionalIso(a.updatedAt, b.updatedAt, 'desc')
    case 'published-asc':
      return compareOptionalIso(a.publishedAt, b.publishedAt, 'asc')
    case 'published-desc':
      return compareOptionalIso(a.publishedAt, b.publishedAt, 'desc')
    case 'title-desc':
      return b.title.localeCompare(a.title)
    case 'title-asc':
      return a.title.localeCompare(b.title)
    default: {
      // Exhaustiveness guard: adding a PostListSort value without a case
      // here is a compile error. At runtime, fall back to a stable order
      // (0) rather than returning undefined → NaN → silently broken sort.
      const _exhaustive: never = sort
      void _exhaustive
      return 0
    }
  }
}

function compareOptionalIso(
  a: string | undefined,
  b: string | undefined,
  direction: 'asc' | 'desc'
): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
}
