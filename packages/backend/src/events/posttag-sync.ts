import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
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
 *
 * Payload-only: it trusts `next` to be the post's current state. The trusted
 * queue is SQS standard, so refresh events can be processed out of order and
 * an older event's `next` would recreate rows of a state the post has left
 * (e.g. a draft's title / excerpt on the public tag API). The processor
 * therefore no longer writes from this diff; it uses
 * `reconcilePostTagsForPost`, which rebuilds from a strongly consistent read
 * of the Post. Kept for the pure key/row math tests.
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

/**
 * Every key a post state may occupy, regardless of its status: for each
 * non-empty tag, the canonical-keyed and the verbatim-keyed row. A state with
 * no publishedAt or no tags occupies none. Deleting a key that does not exist
 * is a no-op, so including the keys of a draft state only widens the cleanup.
 */
function occupiableKeys(p: ContentEventPayload | null): PostTagKey[] {
  if (!p || !p.publishedAt) return []
  const indexed = indexedPost({ ...p, status: 'published' })
  if (!indexed) return []
  return previousKeys(indexed.post)
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

// ---------------------------------------------------------------------------
// Authoritative rebuild from the current Post state
// ---------------------------------------------------------------------------

/**
 * The PostTag rows a post state should have: one per non-empty tag when the
 * post is published with a parseable publishedAt, otherwise none (draft,
 * deleted = `null`, no tags, no / unparseable publishedAt). Pure.
 */
export function desiredPostTagRows(post: ContentEventPayload | null): PostTagItem[] {
  return postTagItemsFromPost(post)
}

/**
 * Keys a rebuild must consider deleting: the canonical- and verbatim-keyed
 * rows of the event's `previous` and `next` (whatever their status), plus
 * `extra` (e.g. stale keys found by a table check, or the rows an earlier
 * attempt wrote). Deduplicated, in first-seen order. Pure.
 */
export function candidateKeys(
  payload: PostIndexEventPayload | null,
  extra: PostTagKey[] = []
): PostTagKey[] {
  const seen = new Map<string, PostTagKey>()
  const all = [
    ...occupiableKeys(payload?.previous ?? null),
    ...occupiableKeys(payload?.next ?? null),
    ...extra,
  ]
  for (const key of all) {
    const k = itemKey(key)
    if (!seen.has(k)) seen.set(k, { tag: key.tag, publishedAtPostId: key.publishedAtPostId })
  }
  return [...seen.values()]
}

/** Deletes = candidates not in `desired`; puts = `desired`. Pure. */
export function planPostTagRebuild(candidates: PostTagKey[], desired: PostTagItem[]): PostTagDiff {
  const desiredKeys = new Set(desired.map(itemKey))
  const deletes = new Map<string, PostTagKey>()
  for (const key of candidates) {
    const k = itemKey(key)
    if (!desiredKeys.has(k))
      deletes.set(k, { tag: key.tag, publishedAtPostId: key.publishedAtPostId })
  }
  return { deletes: [...deletes.values()], puts: desired }
}

/** `tag|publishedAtPostId` — the identity of a PostTag row. */
export function postTagKeyString(key: PostTagKey): string {
  return itemKey(key)
}

/** JSON with object keys sorted, so equal content gives equal strings. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** Order-independent fingerprint of a row set (full row content). */
export function postTagRowsFingerprint(rows: PostTagItem[]): string {
  return stableStringify([...rows].sort((a, b) => itemKey(a).localeCompare(itemKey(b))))
}

/**
 * The Post attributes the rebuild reads — exactly the ContentEventPayload
 * fields. `status` (and others) are DynamoDB reserved words, so every name
 * goes through ExpressionAttributeNames.
 */
export const POST_PAYLOAD_PROJECTION = {
  ProjectionExpression: '#postId, #slug, #title, #status, #format, #excerpt, #publishedAt, #tags',
  ExpressionAttributeNames: {
    '#postId': 'postId',
    '#slug': 'slug',
    '#title': 'title',
    '#status': 'status',
    '#format': 'format',
    '#excerpt': 'excerpt',
    '#publishedAt': 'publishedAt',
    '#tags': 'tags',
  },
} as const

/**
 * Project a (DocumentClient-unmarshalled) Post item onto the event payload
 * shape — the same projection the dispatcher applies to stream images, so a
 * row read here produces the same PostTag rows as its refresh event would.
 * `null` when the row is missing or lacks postId / slug / title.
 */
export function postPayloadFromItem(
  item: Record<string, unknown> | null | undefined
): ContentEventPayload | null {
  if (!item || !item.postId || !item.slug || !item.title) return null
  return {
    postId: item.postId as string,
    slug: item.slug as string,
    title: item.title as string,
    status: (item.status ?? 'draft') as ContentEventPayload['status'],
    format: item.format as ContentEventPayload['format'],
    excerpt: item.excerpt as string | undefined,
    publishedAt: item.publishedAt as string | undefined,
    tags: item.tags as string[] | undefined,
  }
}

/** Minimal DynamoDBDocumentClient surface the rebuild needs (mockable). */
export interface PostTagSyncClient {
  send(command: GetCommand | PutCommand | DeleteCommand): Promise<unknown>
}

export interface ReconcilePostTagsOpts {
  client: PostTagSyncClient
  /** Physical Post table name. */
  postTable: string
  /** Physical PostTag table name. */
  postTagTable: string
  postId: string
  /**
   * Keys to consider deleting besides the rows of the current state — the
   * event's `candidateKeys(payload)`, or stale keys found by a table check.
   */
  candidates?: PostTagKey[]
  /** Read-write-verify attempts before giving up. Default 5. */
  maxAttempts?: number
  /** Summary line per rebuild. Default `console.log`. */
  log?: (line: string) => void
}

export interface ReconcilePostTagsResult {
  postId: string
  attempts: number
  /** DeleteItem calls issued (a delete of a missing key is a no-op). */
  removed: number
  /** PutItem calls issued. */
  upserted: number
  /** The rows of the state the last attempt verified. */
  rows: PostTagItem[]
}

export const DEFAULT_RECONCILE_MAX_ATTEMPTS = 5

/**
 * Rebuild one post's PostTag rows from its current state:
 *
 *   1. Read the Post with a strongly consistent GetItem and compute its
 *      desired rows (none for a draft, a deleted post, no tags, ...).
 *   2. Delete every candidate key that is not desired, put the desired rows.
 *   3. Re-read the Post strongly. If its desired rows (full content) are
 *      unchanged, done. Otherwise repeat from 2 with the new state, adding
 *      the rows just written to the candidates so they are removed if no
 *      longer desired.
 *
 * Throws after `maxAttempts` attempts without a stable state (logged), so the
 * SQS message is retried and eventually dead-lettered. Read / write errors
 * propagate unchanged.
 *
 * Why the order of refresh events does not matter: every row a run writes
 * comes from a state it read, and the refresh event of that state's
 * successor has it as `previous`, so its candidates cover those keys. The run
 * that finishes last verifies the newest state after its own writes.
 */
export async function reconcilePostTagsForPost(
  opts: ReconcilePostTagsOpts
): Promise<ReconcilePostTagsResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_RECONCILE_MAX_ATTEMPTS
  const log = opts.log ?? ((line: string) => console.log(line))
  const { client, postTable, postTagTable, postId } = opts

  async function readCurrent(): Promise<ContentEventPayload | null> {
    const res = (await client.send(
      new GetCommand({
        TableName: postTable,
        Key: { postId },
        ConsistentRead: true,
        ...POST_PAYLOAD_PROJECTION,
      })
    )) as { Item?: Record<string, unknown> }
    return postPayloadFromItem(res.Item)
  }

  let candidates = candidateKeys(null, opts.candidates ?? [])
  let desired = desiredPostTagRows(await readCurrent())
  let removed = 0
  let upserted = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { deletes, puts } = planPostTagRebuild(candidates, desired)
    await Promise.all([
      ...deletes.map((key) =>
        client.send(new DeleteCommand({ TableName: postTagTable, Key: key }))
      ),
      ...puts.map((item) => client.send(new PutCommand({ TableName: postTagTable, Item: item }))),
    ])
    removed += deletes.length
    upserted += puts.length

    const after = desiredPostTagRows(await readCurrent())
    if (postTagRowsFingerprint(after) === postTagRowsFingerprint(desired)) {
      log(
        `[posttag-sync] postId=${postId} attempts=${attempt} removed=${removed} upserted=${upserted}`
      )
      return { postId, attempts: attempt, removed, upserted, rows: desired }
    }
    // The post changed while we wrote: what we just put may now be stale.
    candidates = candidateKeys(null, [...candidates, ...desired])
    desired = after
  }

  const message =
    `[posttag-sync] postId=${postId} did not converge after ${maxAttempts} attempts ` +
    `(removed=${removed} upserted=${upserted}); the post kept changing during the rebuild`
  console.error(message)
  throw new Error(message)
}
