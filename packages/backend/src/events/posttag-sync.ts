import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
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
   * Rows present in the new projection. The rebuild writes each as an
   * upsert guarded by the Post state it was computed from (see
   * `reconcilePostTagsForPost`).
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

/**
 * Unambiguous in-memory identity of a PostTag row. JSON-encoded so that no
 * pair of distinct (tag, publishedAtPostId) values can collide: both parts
 * can contain any character (tags and postIds written through the API
 * directly are free-form), so a plain delimiter such as `tag|key` would map
 * `('a|b', 'c')` and `('a', 'b|c')` to the same string.
 */
function itemKey(item: PostTagItem | PostTagKey): string {
  return JSON.stringify([item.tag, item.publishedAtPostId])
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

/** Unambiguous identity of a PostTag row (see `itemKey`). */
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

// ---------------------------------------------------------------------------
// Guarded rebuild: every PostTag row is committed only while the Post still
// holds the exact state the row was computed from.
// ---------------------------------------------------------------------------

/**
 * The Post attributes a PostTag row depends on, plus `updatedAt` (bumped on
 * every AppSync write) and the `postId` key. Together they are the state
 * "fingerprint": the guard asserts each one is unchanged when a row is
 * committed.
 */
export const POST_STATE_ATTRIBUTES = [
  'postId',
  'status',
  'publishedAt',
  'tags',
  'slug',
  'title',
  'excerpt',
  'format',
  'updatedAt',
] as const

type PostStateAttribute = (typeof POST_STATE_ATTRIBUTES)[number]

/**
 * The fingerprint attributes of a Post item as read (DocumentClient
 * unmarshalled). An attribute absent from the item is absent here; a
 * DynamoDB NULL is `null`. `null` (the whole state) = no Post item.
 */
export type PostState = Partial<Record<PostStateAttribute, unknown>> | null

/**
 * GetItem projection for the fingerprint attributes. `status` (and others)
 * are DynamoDB reserved words, so every name goes through
 * ExpressionAttributeNames.
 */
export const POST_STATE_PROJECTION = {
  ProjectionExpression: POST_STATE_ATTRIBUTES.map((a) => `#${a}`).join(', '),
  ExpressionAttributeNames: Object.fromEntries(POST_STATE_ATTRIBUTES.map((a) => [`#${a}`, a])),
}

/** Pick the fingerprint attributes of a read item. Pure. */
export function postStateFromItem(item: Record<string, unknown> | null | undefined): PostState {
  if (!item) return null
  const state: Partial<Record<PostStateAttribute, unknown>> = {}
  for (const a of POST_STATE_ATTRIBUTES) if (item[a] !== undefined) state[a] = item[a]
  return state
}

/** Sets (SS / NS) as tagged sorted arrays, so stableStringify can tell them apart. */
function normalizeForFingerprint(value: unknown): unknown {
  if (value instanceof Set) {
    return { $set: [...value].map((v) => stableStringify(v)).sort() }
  }
  if (Array.isArray(value)) return value.map(normalizeForFingerprint)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        normalizeForFingerprint(v),
      ])
    )
  }
  return value
}

/**
 * Equality key of a Post state: equal strings ⇔ every fingerprint attribute
 * is equal (absent ≠ null; list order matters). `'absent'` for no item. Pure.
 */
export function postStateFingerprint(state: PostState): string {
  if (state === null) return 'absent'
  return stableStringify(normalizeForFingerprint(state))
}

export interface PostStateCondition {
  ConditionExpression: string
  ExpressionAttributeNames: Record<string, string>
  ExpressionAttributeValues: Record<string, unknown>
}

/**
 * ConditionCheck expression asserting the Post item still holds `state`
 * exactly: for each fingerprint attribute, `#a = :a` when it has a value,
 * `attribute_type(#a, :nullType)` when it is a DynamoDB NULL (equality with a
 * NULL operand is not a dependable comparison), `attribute_not_exists(#a)`
 * when absent. For `null` (no Post item) it asserts the item still does not
 * exist: `attribute_not_exists(#postId)`. Pure.
 */
export function buildPostStateCondition(state: PostState): PostStateCondition {
  if (state === null) {
    return {
      ConditionExpression: 'attribute_not_exists(#postId)',
      ExpressionAttributeNames: { '#postId': 'postId' },
      ExpressionAttributeValues: {},
    }
  }
  const clauses: string[] = []
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  for (const a of POST_STATE_ATTRIBUTES) {
    const name = `#${a}`
    names[name] = a
    const v = state[a]
    if (v === undefined) {
      clauses.push(`attribute_not_exists(${name})`)
    } else if (v === null) {
      clauses.push(`attribute_type(${name}, :nullType)`)
      values[':nullType'] = 'NULL'
    } else {
      clauses.push(`${name} = :${a}`)
      values[`:${a}`] = v
    }
  }
  return {
    ConditionExpression: clauses.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }
}

/** The `ConditionCheck` transaction item guarding a PostTag write on `state`. */
function postStateCheck(postTable: string, postId: string, state: PostState) {
  const { ExpressionAttributeValues, ...condition } = buildPostStateCondition(state)
  return {
    ConditionCheck: {
      TableName: postTable,
      Key: { postId },
      ...condition,
      // An empty values map is rejected by DynamoDB.
      ...(Object.keys(ExpressionAttributeValues).length > 0 ? { ExpressionAttributeValues } : {}),
    },
  }
}

/**
 * True when a TransactWriteItems [ConditionCheck(Post), Put/Delete(PostTag)] was
 * cancelled because the Post no longer holds the guarded state. Any other
 * cancellation (TransactionConflict, throttling, validation) is not.
 */
export function isPostStateGuardFailure(err: unknown): boolean {
  const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> } | null
  return (
    e?.name === 'TransactionCanceledException' &&
    e.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed'
  )
}

/** Minimal DynamoDBDocumentClient surface the rebuild needs (mockable). */
export interface PostTagSyncClient {
  send(command: GetCommand | TransactWriteCommand): Promise<unknown>
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
  /**
   * Awaited immediately before every write call (each guarded
   * TransactWriteItems). The migration CLI passes its rate limiter here; the
   * trusted processor passes none.
   */
  beforeWrite?: () => Promise<void>
}

export interface ReconcilePostTagsResult {
  postId: string
  attempts: number
  /** Guarded PostTag deletes committed (deleting a missing key is a no-op). */
  deletes: number
  /** Guarded PostTag Puts committed. */
  puts: number
  /** Guarded writes (delete or put) cancelled because the Post had changed. */
  guardFailures: number
  /** The rows of the state the last attempt verified. */
  rows: PostTagItem[]
}

export const DEFAULT_RECONCILE_MAX_ATTEMPTS = 5

/**
 * Rebuild one post's PostTag rows from its current state:
 *
 *   1. Read the Post with a strongly consistent GetItem: state `s`, rows(s)
 *      (none for a draft, a deleted post, no tags, ...).
 *   2. Delete every candidate key not in rows(s), then put each row of
 *      rows(s) — one call at a time, each a TransactWriteItems of a
 *      ConditionCheck that the Post still holds `s` exactly (every
 *      fingerprint attribute, or "no item" for a deleted post; see
 *      `buildPostStateCondition`) plus the Delete or Put. If a guard fails,
 *      the Post changed: stop this attempt.
 *   3. Read again strongly. Same fingerprint and no guard failure → done.
 *      Otherwise add rows(s)'s keys to the candidates and repeat with the
 *      new state.
 *
 * Throws after `maxAttempts` attempts without a stable state (logged), so
 * the SQS message is retried and eventually dead-lettered. Other read /
 * write errors are logged and propagate unchanged (nothing is retried here).
 *
 * Every committed write is correct when it commits: a put writes a row of
 * the current state, a delete removes a key that is not a row of the
 * current state. So no worker — however stale its read, wherever it
 * crashes — can expose an old state's row or remove a current one.
 * Why a row committed for `s` cannot outlive `s`: the Post can only leave
 * `s` through a later write, whose stream event has `previous = s`, so its
 * candidates contain rows(s)'s keys — and that event exists only after the
 * commit, so its rebuild runs after it. A row of the current state can only
 * be missing if the refresh into that state has not (successfully) run yet:
 * the SQS retry, or `--check-post-tags --apply` after a DLQ, writes it.
 */
export async function reconcilePostTagsForPost(
  opts: ReconcilePostTagsOpts
): Promise<ReconcilePostTagsResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_RECONCILE_MAX_ATTEMPTS
  const log = opts.log ?? ((line: string) => console.log(line))
  const beforeWrite = opts.beforeWrite ?? (() => Promise.resolve())
  const { client, postTable, postTagTable, postId } = opts

  async function readState(): Promise<PostState> {
    try {
      const res = (await client.send(
        new GetCommand({
          TableName: postTable,
          Key: { postId },
          ConsistentRead: true,
          ...POST_STATE_PROJECTION,
        })
      )) as { Item?: Record<string, unknown> }
      return postStateFromItem(res.Item)
    } catch (err) {
      console.error(`[posttag-sync] postId=${postId} Post read failed`, err)
      throw err
    }
  }

  let candidates = candidateKeys(null, opts.candidates ?? [])
  let deletes = 0
  let puts = 0
  let guardFailures = 0
  let state = await readState()

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const rows = desiredPostTagRows(postPayloadFromItem(state))
    const plan = planPostTagRebuild(candidates, rows)

    // Every write — delete or put — is one TransactWriteItems guarded by a
    // ConditionCheck that the Post still holds `state`, so each committed
    // write is correct at its commit: a delete only removes a key outside
    // rows(state) while `state` is current, a put only writes rows(state).
    // A guard failure means the Post changed: stop and re-read.
    const check = postStateCheck(postTable, postId, state)
    let guarded = true
    const writes: Array<{ kind: 'delete' | 'put'; key: PostTagKey; item?: PostTagItem }> = [
      ...plan.deletes.map((key) => ({ kind: 'delete' as const, key })),
      ...rows.map((item) => ({ kind: 'put' as const, key: item, item })),
    ]
    for (const w of writes) {
      await beforeWrite()
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              check,
              w.kind === 'delete'
                ? {
                    Delete: {
                      TableName: postTagTable,
                      Key: { tag: w.key.tag, publishedAtPostId: w.key.publishedAtPostId },
                    },
                  }
                : { Put: { TableName: postTagTable, Item: w.item } },
            ],
          })
        )
        if (w.kind === 'delete') deletes++
        else puts++
      } catch (err) {
        if (!isPostStateGuardFailure(err)) {
          console.error(
            `[posttag-sync] postId=${postId} guarded ${w.kind} failed tag=${w.key.tag} publishedAtPostId=${w.key.publishedAtPostId}`,
            err
          )
          throw err
        }
        guardFailures++
        guarded = false
        break
      }
    }

    // Whatever this attempt committed must be removed if no longer desired.
    candidates = candidateKeys(null, [...candidates, ...rows])
    const next = await readState()
    if (guarded && postStateFingerprint(next) === postStateFingerprint(state)) {
      log(
        `[posttag-sync] postId=${postId} attempts=${attempt} deletes=${deletes} puts=${puts} guardFailures=${guardFailures}`
      )
      return { postId, attempts: attempt, deletes, puts, guardFailures, rows }
    }
    state = next
  }

  const message =
    `[posttag-sync] postId=${postId} did not converge after ${maxAttempts} attempts ` +
    `(deletes=${deletes} puts=${puts} guardFailures=${guardFailures}); the post kept changing during the rebuild`
  console.error(message)
  throw new Error(message)
}
