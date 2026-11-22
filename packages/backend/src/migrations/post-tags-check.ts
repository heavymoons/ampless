/**
 * `--check-post-tags`: compare the PostTag table against the rows computed
 * from the current Post table, and optionally repair the difference.
 *
 * Both tables are scanned with strongly consistent reads. For every Post the
 * desired rows are those `desiredPostTagRows` computes (published, parseable
 * publishedAt, at least one tag); every other row is stale. Reported:
 *   - `stale`   — a PostTag row that should not exist: its post is missing
 *                 (`post-missing`), has no rows at all (`not-indexed`: draft,
 *                 no tags, unparseable date), or has rows under other keys
 *                 (`key-mismatch`: a legacy verbatim key, a removed tag, ...).
 *   - `content` — the key is desired but the row's content (title, excerpt,
 *                 slug, tags, format, publishedAt, postId) differs.
 *   - `missing` — a desired row that does not exist.
 *
 * With `apply`, every affected post is rebuilt with the same authoritative
 * `reconcilePostTagsForPost` the trusted processor uses, passing the stale
 * keys found for that post as extra candidates, and the tables are checked
 * again. Each delete and put is committed only while the Post still holds
 * the state the rebuild read. Every write call (a guarded TransactWriteItems) waits
 * for the shared write limiter first, so `maxWritesPerSecond` bounds the
 * writes within one post's rebuild as well as across posts. The two scans are not one snapshot, so the result is only
 * meaningful while writers are stopped and the event pipeline is drained
 * (see the RUNBOOK); a post edited during the check can show up as a
 * mismatch that its own refresh event is about to fix.
 */
import {
  ScanCommand,
  type DeleteCommand,
  type GetCommand,
  type TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type { ContentEventPayload } from 'ampless'
import {
  POST_PAYLOAD_PROJECTION,
  desiredPostTagRows,
  postPayloadFromItem,
  postTagKeyString,
  reconcilePostTagsForPost,
  stableStringify,
  type PostTagItem,
  type PostTagKey,
} from '../events/posttag-sync.js'
import { createWriteLimiter } from './write-limiter.js'

export type PostTagMismatch =
  | {
      kind: 'stale'
      postId: string | null
      key: PostTagKey
      reason: 'post-missing' | 'not-indexed' | 'key-mismatch'
    }
  | { kind: 'content'; postId: string; key: PostTagKey }
  | { kind: 'missing'; postId: string; key: PostTagKey }

/** Minimal DynamoDBDocumentClient surface the check needs (mockable). */
export interface PostTagCheckClient {
  send(command: ScanCommand | GetCommand | DeleteCommand | TransactWriteCommand): Promise<unknown>
}

export interface RunPostTagCheckOpts {
  client: PostTagCheckClient
  postTable: string
  postTagTable: string
  /** Repair the mismatches. When false (default) only reports them. */
  apply?: boolean
  /**
   * Upper bound on PostTag write calls per second during repair (DeleteItem
   * and TransactWriteItems), enforced before each call. Default 10.
   */
  maxWritesPerSecond?: number
  /** Scan page size (DynamoDB `Limit`). Default: DynamoDB's 1 MB pages. */
  pageSize?: number
  /** Report lines. Default `console.log`. */
  log?: (line: string) => void
  /** Injectable for tests. Default: setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable clock (ms) for tests. Default `Date.now`. */
  now?: () => number
}

export interface PostTagCheckSummary {
  apply: boolean
  postsScanned: number
  postTagRowsScanned: number
  /** Mismatches found by the first check. */
  mismatches: PostTagMismatch[]
  /** Posts the repair targeted (apply only). */
  repaired: number
  /** Posts whose repair threw (apply only). */
  failed: Array<{ postId: string | null; error: string }>
  /** Mismatches found by the check after the repair; `null` in dry-run. */
  remaining: PostTagMismatch[] | null
}

const ROW_FIELDS = [
  'tag',
  'publishedAtPostId',
  'postId',
  'publishedAt',
  'slug',
  'title',
  'tags',
  'format',
  'excerpt',
] as const

/** The PostTagItem fields of a scanned row (metadata attributes dropped). */
function rowContent(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of ROW_FIELDS) if (row[f] !== undefined) out[f] = row[f]
  return out
}

/**
 * The post a PostTag row belongs to: its `postId`, else the SK suffix. The
 * SK is `<publishedAt>#<postId>`; a publishedAt never contains `#` but a
 * postId may, so the postId is everything after the FIRST `#`.
 */
function rowPostId(row: Record<string, unknown>): string | null {
  if (typeof row.postId === 'string' && row.postId !== '') return row.postId
  const sk = row.publishedAtPostId
  if (typeof sk === 'string' && sk.includes('#')) return sk.slice(sk.indexOf('#') + 1) || null
  return null
}

/**
 * Compare scanned PostTag rows with the rows desired by the scanned posts.
 * `posts` maps every scanned postId to its projection (`null` when the row
 * lacks slug / title, which yields no rows). Pure.
 */
export function comparePostTags(
  posts: Map<string, ContentEventPayload | null>,
  rows: Array<Record<string, unknown>>
): PostTagMismatch[] {
  const desired = new Map<string, PostTagItem>()
  const postsWithRows = new Set<string>()
  for (const [postId, post] of posts) {
    for (const item of desiredPostTagRows(post)) {
      desired.set(postTagKeyString(item), item)
      postsWithRows.add(postId)
    }
  }

  const mismatches: PostTagMismatch[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = { tag: String(row.tag), publishedAtPostId: String(row.publishedAtPostId) }
    const k = postTagKeyString(key)
    seen.add(k)
    const want = desired.get(k)
    const postId = rowPostId(row)
    if (!want) {
      const reason =
        postId === null || !posts.has(postId)
          ? 'post-missing'
          : postsWithRows.has(postId)
            ? 'key-mismatch'
            : 'not-indexed'
      mismatches.push({ kind: 'stale', postId, key, reason })
    } else if (
      stableStringify(rowContent(row)) !==
      stableStringify(rowContent(want as unknown as Record<string, unknown>))
    ) {
      mismatches.push({ kind: 'content', postId: want.postId, key })
    }
  }
  for (const [k, item] of desired) {
    if (!seen.has(k)) {
      mismatches.push({
        kind: 'missing',
        postId: item.postId,
        key: { tag: item.tag, publishedAtPostId: item.publishedAtPostId },
      })
    }
  }
  return mismatches
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

async function scanAll(
  client: PostTagCheckClient,
  input: Omit<ConstructorParameters<typeof ScanCommand>[0], 'ExclusiveStartKey'>
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = (await client.send(
      new ScanCommand({
        ...input,
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      })
    )) as { Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> }
    items.push(...(page.Items ?? []))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
  return items
}

async function checkOnce(
  opts: RunPostTagCheckOpts
): Promise<{ postsScanned: number; rowsScanned: number; mismatches: PostTagMismatch[] }> {
  const limit = opts.pageSize !== undefined ? { Limit: opts.pageSize } : {}
  const rows = await scanAll(opts.client, { TableName: opts.postTagTable, ...limit })
  const postItems = await scanAll(opts.client, {
    TableName: opts.postTable,
    ...POST_PAYLOAD_PROJECTION,
    ...limit,
  })
  const posts = new Map<string, ContentEventPayload | null>()
  for (const item of postItems) {
    if (typeof item.postId !== 'string' || item.postId === '') {
      console.error('[check-post-tags] scanned Post row has no string postId; skipping', item)
      continue
    }
    posts.set(item.postId, postPayloadFromItem(item))
  }
  return {
    postsScanned: postItems.length,
    rowsScanned: rows.length,
    mismatches: comparePostTags(posts, rows),
  }
}

function describeMismatch(m: PostTagMismatch): string {
  const where = `tag=${m.key.tag} publishedAtPostId=${m.key.publishedAtPostId} postId=${m.postId ?? '(unknown)'}`
  if (m.kind === 'stale') return `STALE ${where} reason=${m.reason}`
  if (m.kind === 'content') return `CONTENT MISMATCH ${where}`
  return `MISSING ${where}`
}

/**
 * Check (and with `apply`, repair) the PostTag table against the Post
 * table. Per-post repair failures are logged and recorded; a Scan failure is
 * thrown.
 */
export async function runPostTagCheck(opts: RunPostTagCheckOpts): Promise<PostTagCheckSummary> {
  const apply = opts.apply ?? false
  const limiter = createWriteLimiter({
    maxWritesPerSecond: opts.maxWritesPerSecond ?? 10,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  })
  const log = opts.log ?? ((line: string) => console.log(line))

  const first = await checkOnce(opts)
  for (const m of first.mismatches) log(describeMismatch(m))
  const summary: PostTagCheckSummary = {
    apply,
    postsScanned: first.postsScanned,
    postTagRowsScanned: first.rowsScanned,
    mismatches: first.mismatches,
    repaired: 0,
    failed: [],
    remaining: null,
  }
  if (!apply) return summary

  // Group by post; stale keys become extra candidates for that post.
  const byPost = new Map<string | null, PostTagKey[]>()
  for (const m of first.mismatches) {
    const keys = byPost.get(m.postId) ?? []
    if (m.kind === 'stale') keys.push(m.key)
    byPost.set(m.postId, keys)
  }

  for (const [postId, staleKeys] of byPost) {
    if (postId === null) {
      const error = `cannot determine the post of ${staleKeys.length} stale row(s); delete them by hand`
      console.error(`[check-post-tags] ${error}`, staleKeys)
      summary.failed.push({ postId: null, error })
      continue
    }
    try {
      await reconcilePostTagsForPost({
        client: opts.client,
        postTable: opts.postTable,
        postTagTable: opts.postTagTable,
        postId,
        candidates: staleKeys,
        log,
        beforeWrite: () => limiter.acquire(),
      })
      summary.repaired++
    } catch (err) {
      console.error(`[check-post-tags] repair failed for postId=${postId}`, err)
      summary.failed.push({ postId, error: errorMessage(err) })
    }
  }

  const after = await checkOnce(opts)
  for (const m of after.mismatches) log(`STILL ${describeMismatch(m)}`)
  summary.remaining = after.mismatches
  return summary
}
