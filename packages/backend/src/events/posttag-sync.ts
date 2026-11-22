import { canonicalizeAwsDateTime } from 'ampless'
import type { ContentEventPayload, ContentFormat, PostIndexEventPayload } from 'ampless'

/**
 * Single row in the denormalized PostTag index. The (tag,
 * publishedAtPostId) pair is the table's composite primary key;
 * remaining fields exist for the listPostsByTag resolver to render
 * without a second Post lookup.
 *
 * `format` / `excerpt` are optional: the PostTag row is written by a direct
 * DynamoDB put (no `removeUndefinedValues`), so absent values must be omitted
 * rather than set to `undefined` (see `postTagItemsFromPost`).
 */
export interface PostTagItem {
  tag: string
  publishedAtPostId: string
  postId: string
  publishedAt: string
  slug: string
  title: string
  tags: string[]
  format?: ContentFormat
  excerpt?: string
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
 *
 * `publishedAt` is written to the PostTag row (SK and attribute) in
 * canonical fixed-width UTC, because the listPostsByTag resolver orders
 * and bounds the SK lexically. The Post row itself may hold any
 * AWSDateTime (`+09:00`, no seconds, ...) when written through the API
 * directly. Rows written before canonicalization used the verbatim
 * string, so deletes cover both the verbatim-keyed and canonical-keyed
 * rows of `previous` — the next save of a legacy post replaces its old
 * rows. A publishedAt that does not parse produces no rows (the resolver
 * would hide them anyway).
 */
export function computePostTagDiff(payload: PostIndexEventPayload): PostTagDiff {
  const nextEntries = postTagItemsFromPost(payload.next)
  const nextKeys = new Set(nextEntries.map(itemKey))
  const deletes = new Map<string, PostTagKey>()
  for (const key of previousKeys(payload.previous)) {
    const k = itemKey(key)
    if (!nextKeys.has(k)) deletes.set(k, key)
  }
  return { deletes: [...deletes.values()], puts: nextEntries }
}

/**
 * The post, its verbatim publishedAt and its non-empty tags when it belongs
 * in the index (published, with a publishedAt and at least one tag),
 * otherwise `null`.
 */
function indexedPost(
  p: ContentEventPayload | null
): { post: ContentEventPayload; publishedAt: string; tags: string[] } | null {
  if (!p) return null
  if (p.status !== 'published') return null
  if (!p.publishedAt) return null
  const tags = (Array.isArray(p.tags) ? p.tags : []).filter(
    (t): t is string => typeof t === 'string' && t.length > 0
  )
  if (tags.length === 0) return null
  return { post: p, publishedAt: p.publishedAt, tags }
}

/** Every key `previous` may occupy: canonical-keyed and verbatim-keyed. */
function previousKeys(p: ContentEventPayload | null): PostTagKey[] {
  const indexed = indexedPost(p)
  if (!indexed) return []
  const { post, publishedAt, tags } = indexed
  const canonical = canonicalizeAwsDateTime(publishedAt)
  const stamps = canonical && canonical !== publishedAt ? [canonical, publishedAt] : [publishedAt]
  return tags.flatMap((tag) =>
    stamps.map((stamp) => ({ tag, publishedAtPostId: `${stamp}#${post.postId}` }))
  )
}

function postTagItemsFromPost(p: ContentEventPayload | null): PostTagItem[] {
  const indexed = indexedPost(p)
  if (!indexed) return []
  const { post, tags } = indexed
  const publishedAt = canonicalizeAwsDateTime(indexed.publishedAt)
  if (!publishedAt) {
    console.error(
      `[posttag-sync] post ${post.postId} has unparseable publishedAt ${JSON.stringify(indexed.publishedAt)}; no PostTag rows written`
    )
    return []
  }
  const allTags = Array.isArray(post.tags) ? post.tags : []
  return tags.map((tag) => ({
    tag,
    publishedAtPostId: `${publishedAt}#${post.postId}`,
    postId: post.postId,
    publishedAt,
    slug: post.slug,
    title: post.title,
    tags: allTags,
    // Omit when absent — PostTag rows are written via a direct DynamoDB put
    // with no `removeUndefinedValues`, so an `undefined` attribute would
    // throw "Unsupported type passed: undefined".
    ...(post.format !== undefined && { format: post.format }),
    ...(post.excerpt !== undefined && { excerpt: post.excerpt }),
  }))
}

function itemKey(item: PostTagItem | PostTagKey): string {
  return `${item.tag}|${item.publishedAtPostId}`
}
