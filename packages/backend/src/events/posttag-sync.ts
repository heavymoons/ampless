import type { ContentEventPayload, PostIndexEventPayload } from 'ampless'

/**
 * Single row in the denormalized PostTag index. The (tag,
 * publishedAtPostId) pair is the table's composite primary key;
 * remaining fields exist for the listPostsByTag resolver to render
 * without a second Post lookup.
 */
export interface PostTagItem {
  tag: string
  publishedAtPostId: string
  postId: string
  publishedAt: string
  slug: string
  title: string
  tags: string[]
}

/**
 * Key-only shape for delete commands. Matches the table's identifier
 * exactly so callers don't need to strip extra fields.
 */
export interface PostTagKey {
  tag: string
  publishedAtPostId: string
}

export interface PostTagDiff {
  /** Rows whose key no longer exists in the new projection — DeleteItem. */
  deletes: PostTagKey[]
  /**
   * Rows present in the new projection — PutItem. Unconditional Put
   * doubles as upsert, which is exactly the desired behaviour: any
   * orphan left from a partial earlier run self-heals on the next
   * refresh, and we never need a conditional + fallback dance.
   */
  puts: PostTagItem[]
}

/**
 * Compute the PostTag rows to delete and upsert for a single Post
 * mutation. `previous` carries the row state before the mutation
 * (null on INSERT), `next` carries it after (null on REMOVE).
 *
 * Only published posts with a `publishedAt` timestamp and a non-empty
 * tag list contribute to the index. Draft posts have zero entries —
 * unpublishing a post therefore manifests as deletes of every
 * previous entry plus zero new puts.
 */
export function computePostTagDiff(payload: PostIndexEventPayload): PostTagDiff {
  const previousEntries = postTagItemsFromPost(payload.previous)
  const nextEntries = postTagItemsFromPost(payload.next)
  const nextKeys = new Set(nextEntries.map(itemKey))
  const deletes = previousEntries
    .filter((p) => !nextKeys.has(itemKey(p)))
    .map<PostTagKey>((p) => ({ tag: p.tag, publishedAtPostId: p.publishedAtPostId }))
  return { deletes, puts: nextEntries }
}

function postTagItemsFromPost(p: ContentEventPayload | null): PostTagItem[] {
  if (!p) return []
  if (p.status !== 'published') return []
  if (!p.publishedAt) return []
  const tags = Array.isArray(p.tags) ? p.tags : []
  return tags
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .map((tag) => ({
      tag,
      publishedAtPostId: `${p.publishedAt}#${p.postId}`,
      postId: p.postId,
      publishedAt: p.publishedAt!,
      slug: p.slug,
      title: p.title,
      tags,
    }))
}

function itemKey(item: PostTagItem | PostTagKey): string {
  return `${item.tag}|${item.publishedAtPostId}`
}
