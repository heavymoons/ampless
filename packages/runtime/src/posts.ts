// Server-side post fetching for the public blog. Calls the custom
// `listPublishedPosts` / `getPublishedPost` queries — those resolvers
// hard-code the `status='published'` filter, so drafts are never exposed
// even if a guest hits the AppSync API directly.
//
// authMode is 'apiKey' because Amplify Gen 2 custom handlers
// (`a.handler.custom`) don't support `allow.guest()` — only apiKey /
// userPool / lambda / group / owner. See RUNBOOK.md for the API key
// rotation runbook.
//
// The client is stateless: `generateServerClientUsingReqRes` run with
// `nextServerContext: null` uses Amplify's `sharedInMemoryStorage`
// guest-role path — no Cognito guest identityId Set-Cookie is written
// on public route responses (`/og/[slug]`, `/feed.xml`, etc.).

import { generateServerClientUsingReqRes } from '@aws-amplify/adapter-nextjs/api'
import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { decodeAwsJson, type Post, type PostMetadata } from 'ampless'
import type { AmplessOutputs } from './outputs.js'

// Wire shape of the three queries this module calls. The actual
// generated `Schema` type from the user's amplify/data/resource.ts is
// far richer, but the runtime only cares about these three —
// templates pass their generated Schema in if they want full typing
// of unrelated client.models / client.queries surfaces, but the
// runtime narrows to this minimal shape internally so it can compile
// without depending on any single template's schema definition.
export interface PublicPostShape {
  postId: string
  slug: string
  title: string
  excerpt?: string | null
  format?: string | null
  body?: unknown
  status?: string | null
  publishedAt?: string | null
  tags?: Array<string | null> | null
  metadata?: unknown
  /**
   * ISO 8601 timestamp from DynamoDB's auto-managed `updatedAt`.
   * Surfaced through the `PublicPost` projection so middleware can
   * compute the `metadata.cache='auto'` cooldown.
   */
  updatedAt?: string | null
}

export interface PublicPostConnectionShape {
  items?: Array<PublicPostShape | null> | null
  nextToken?: string | null
}

interface QueryResponse<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface PublicQueries {
  listPublishedPosts(
    contextSpec: unknown,
    args: { from?: string; to?: string; limit?: number; nextToken?: string }
  ): Promise<QueryResponse<PublicPostConnectionShape>>
  getPublishedPost(
    contextSpec: unknown,
    args: { slug: string }
  ): Promise<QueryResponse<PublicPostShape>>
  listPostsByTag(
    contextSpec: unknown,
    args: { tag: string; limit?: number; nextToken?: string }
  ): Promise<QueryResponse<PublicPostConnectionShape>>
}

interface PublicClient {
  queries: PublicQueries
}

export interface ListPostsOptions {
  /** ISO 8601 timestamp; SK lower bound (inclusive). */
  from?: string
  /** ISO 8601 timestamp; SK upper bound (inclusive). */
  to?: string
  limit?: number
  /** Opaque cursor returned by a previous call. */
  nextToken?: string
  /**
   * Fill short pages (default `true`). The resolver can return fewer than
   * `limit` posts while `nextToken` is set (DynamoDB's 1 MB page cap, or
   * rows the resolver drops), so by default the runtime keeps reading until
   * the page is full — what first-page-only views need. Pass `false` from a
   * consumer that already follows `nextToken` with its own round-trip
   * bound (llms.txt, the public MCP tools via `collectBounded`): then this
   * is exactly one resolver call and the raw AppSync token is returned.
   */
  fill?: boolean
}

export interface ListPostsByTagOptions {
  limit?: number
  nextToken?: string
  /**
   * Fill short pages (default `true`). The resolver can return fewer than
   * `limit` posts while `nextToken` is set (DynamoDB's 1 MB page cap, or
   * rows the resolver drops), so by default the runtime keeps reading until
   * the page is full — what first-page-only views need. Pass `false` from a
   * consumer that already follows `nextToken` with its own round-trip
   * bound (llms.txt, the public MCP tools via `collectBounded`): then this
   * is exactly one resolver call and the raw AppSync token is returned.
   */
  fill?: boolean
}

export interface ListPostsResult {
  items: Post[]
  nextToken: string | null
}

export interface PostsApi {
  listPublishedPosts(opts?: ListPostsOptions): Promise<ListPostsResult>
  getPublishedPost(slug: string): Promise<Post | null>
  listPostsByTag(tag: string, opts?: ListPostsByTagOptions): Promise<ListPostsResult>
}

// `body` / `metadata` are AWSJSON scalars on the wire — see
// `packages/ampless/src/awsjson.ts` for the encode/decode contract.
// Metadata returns undefined for nullish / malformed payloads so
// callers can rely on `post.metadata?.no_layout`.
function decodeMetadata(value: unknown): PostMetadata | undefined {
  if (value === null || value === undefined) return undefined
  const parsed = decodeAwsJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as PostMetadata)
    : undefined
}

function toCorePost(p: PublicPostShape): Post {
  return {
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: (p.format ?? 'markdown') as Post['format'],
    body: decodeAwsJson(p.body),
    status: (p.status ?? 'draft') as Post['status'],
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
    metadata: decodeMetadata(p.metadata),
    updatedAt: p.updatedAt ?? undefined,
  }
}

/** Page size used once a page has come back short (see `fillPage`). */
const FILL_CHUNK = 100

/**
 * Most EMPTY resolver calls tolerated while filling one page (see
 * `fillPage`): calls that yield no new visible post. Productive calls are
 * not budgeted — each adds at least one post, so there are at most `limit`
 * of them. With FILL_CHUNK rows per call this tolerates ~2,000 dropped
 * index rows (fewer when DynamoDB's 1 MB page cap stops a call earlier)
 * before failing explicitly.
 */
const MAX_EMPTY_FILL_CALLS = 20

/**
 * Most same-key group reads per page for listPublishedPosts (see
 * `fillPublishedPage`): one when resuming an anchored cursor, plus one per
 * tie group observed across an internal read boundary. Exceeding it fails
 * explicitly with PostListTieError rather than reading on.
 */
const MAX_GROUP_READS = 5

/** Query pages one same-key group read may follow (see `readGroup`). */
const MAX_GROUP_READ_PAGES = 5

const CURSOR_PREFIX = 'ampless-c2.'

/** Decode-side caps: cursors come back from public callers. */
const MAX_CURSOR_KEY_LENGTH = 1024
const MAX_CURSOR_TIE_IDS = 200

type ListOperation = 'listPublishedPosts' | 'listPostsByTag'

/**
 * Index sort key of a returned item, rebuilt from its fields: the `byStatus`
 * GSI sorts by the stored `publishedAt` string, PostTag by
 * `${publishedAt}#${postId}` (both resolvers return `publishedAt` exactly as
 * stored). `undefined` when the item has no publishedAt, which neither index
 * can hold.
 */
function sortKeyOf(operation: ListOperation, post: Post): string | undefined {
  if (!post.publishedAt) return undefined
  return operation === 'listPostsByTag' ? `${post.publishedAt}#${post.postId}` : post.publishedAt
}

/** DynamoDB orders string sort keys by their UTF-8 bytes. */
function compareKeys(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Position inside the listing, as a sort key rather than an offset: every
 * item whose key sorts after `k` (lists are newest first, i.e. descending)
 * or that equals `k` and is listed in `ids` was already returned.
 */
interface Anchor {
  k: string
  ids: string[]
}

interface ChunkCursor {
  /** AppSync nextToken the chunk starts at (null = start of the listing). */
  t: string | null
  /** Sort key of the last returned item, or null when nothing is anchored. */
  k: string | null
  /** postIds already returned whose sort key equals `k` (GSI tie set). */
  ids: string[]
  /** Chunk size the cursor was produced with. */
  c: number
}

function encodeCursor(t: string | null, anchor: Anchor | undefined, c: number): string {
  const ids = anchor?.ids ?? []
  if (ids.length > MAX_CURSOR_TIE_IDS) {
    // Would not decode; fail loudly rather than hand out a cursor that
    // silently restarts somewhere else.
    throw new Error(
      `[ampless] list cursor: ${ids.length} posts share the sort key ${JSON.stringify(anchor?.k)}; more than ${MAX_CURSOR_TIE_IDS} cannot be paged past`
    )
  }
  const cursor: ChunkCursor = { t, k: anchor?.k ?? null, ids, c }
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(token: string): ChunkCursor | undefined {
  if (!token.startsWith(CURSOR_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(
      Buffer.from(token.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8')
    ) as Partial<ChunkCursor>
    if (
      (parsed.t === null || typeof parsed.t === 'string') &&
      (parsed.k === null ||
        (typeof parsed.k === 'string' && parsed.k.length <= MAX_CURSOR_KEY_LENGTH)) &&
      Array.isArray(parsed.ids) &&
      parsed.ids.length <= MAX_CURSOR_TIE_IDS &&
      parsed.ids.every((id) => typeof id === 'string') &&
      (parsed.k !== null || parsed.ids.length === 0) &&
      Number.isInteger(parsed.c) &&
      (parsed.c as number) > 0 &&
      // Cursors reach public callers (e.g. the public MCP `nextCursor`), so
      // never let one ask the resolver for more than a normal chunk.
      (parsed.c as number) <= FILL_CHUNK
    ) {
      return { t: parsed.t, k: parsed.k, ids: parsed.ids, c: parsed.c as number }
    }
  } catch {
    // fall through: not one of ours
  }
  return undefined
}

/**
 * Thrown when MAX_EMPTY_FILL_CALLS resolver calls returned no visible post
 * while the page was still short and the listing continued. An empty call
 * means the resolver dropped every row that call read (see `fillPage`), so
 * this is reached only when that many reads in a row-budget sense were
 * spent on dropped rows — never by valid data that is merely large (1 MB
 * pages always hold at least one row). Rather than return a short (possibly
 * empty) page that first-page-only views (home, tag pages) would render as
 * "no posts", the failure is explicit. `items` holds what was collected and
 * `nextToken` resumes the scan right after it.
 */
export class PostListScanLimitError extends Error {
  readonly operation: ListOperation
  readonly items: Post[]
  readonly nextToken: string
  /** All resolver calls made for this page. */
  readonly calls: number
  /** Calls that yielded no new visible post (reached MAX_EMPTY_FILL_CALLS). */
  readonly emptyCalls: number

  constructor(
    operation: ListOperation,
    items: Post[],
    nextToken: string,
    calls: number,
    emptyCalls: number,
    limit: number
  ) {
    super(
      `${operation}: page has ${items.length}/${limit} posts after ${calls} resolver calls, ${emptyCalls} of which returned no visible post, and the listing continues. ` +
        'Those calls returned only rows the resolver dropped — e.g. a publishedAt after now that sorts before it as a string (a non-canonical offset value, see #406), an unparseable publishedAt, or rows just outside from/to — or rows already returned on an earlier page. ' +
        'Resume with this error\'s nextToken.'
    )
    this.name = 'PostListScanLimitError'
    this.operation = operation
    this.items = items
    this.nextToken = nextToken
    this.calls = calls
    this.emptyCalls = emptyCalls
  }
}

/**
 * Thrown by listPublishedPosts (fill mode) when posts sharing one exact
 * `publishedAt` string cannot be paged without risking a silent skip.
 *
 * The `byStatus` GSI sorts by `publishedAt` only, and DynamoDB documents no
 * order among items with equal GSI sort keys — that order may differ between
 * two Query calls. A position (AppSync token) inside such a tie group can
 * therefore exclude members that moved before it. The runtime protects
 * against that by reading the whole group in ONE Query (a same-key range
 * read, following that read's own pages, up to MAX_GROUP_READ_PAGES); when
 * the tie group itself straddles one of those pages, there is no safe way to
 * page it with this index, and the page fails instead of being returned
 * incomplete. The real fix is a unique composite sort key (#406).
 *
 * - `group-too-large`: the tie group itself straddles a page of the same-key
 *   read (more than 100 tied posts, or tied posts totalling > 1 MB — e.g.
 *   three of ~400 KB), or that read needed more than MAX_GROUP_READ_PAGES
 *   pages (a very dense minute). Other posts of the same minute alone do not
 *   trigger it. Resuming hits the same group, so `nextToken` is null.
 * - `group-read-budget`: more than MAX_GROUP_READS same-key reads were
 *   needed for one page. `nextToken` resumes (with a fresh budget).
 * - `too-many-tied-posts`: more tied ids were returned than a cursor can
 *   carry (200). `nextToken` is null.
 */
export class PostListTieError extends Error {
  readonly operation = 'listPublishedPosts' as const
  readonly reason: 'group-too-large' | 'group-read-budget' | 'too-many-tied-posts'
  /** The tied `publishedAt` string. */
  readonly sortKey: string
  readonly items: Post[]
  readonly nextToken: string | null
  readonly calls: number

  constructor(
    reason: PostListTieError['reason'],
    sortKey: string,
    items: Post[],
    nextToken: string | null,
    calls: number
  ) {
    const why =
      reason === 'group-too-large'
        ? 'reading every post with that publishedAt did not fit in one DynamoDB Query'
        : reason === 'group-read-budget'
          ? `more than ${MAX_GROUP_READS} same-publishedAt group reads were needed for one page`
          : `more than ${MAX_CURSOR_TIE_IDS} posts with that publishedAt were returned`
    super(
      `listPublishedPosts: posts share the publishedAt ${JSON.stringify(sortKey)} and ${why}. ` +
        'The byStatus index orders equal publishedAt values in no documented way, so paging through them could silently skip posts; failing instead. ' +
        'A unique composite sort key is tracked in #406.'
    )
    this.name = 'PostListTieError'
    this.reason = reason
    this.sortKey = sortKey
    this.items = items
    this.nextToken = nextToken
    this.calls = calls
  }
}

/**
 * Collect up to `limit` posts from a list resolver, following `nextToken`.
 *
 * Why: one resolver response can be short while `nextToken` is still set,
 * and the home / tag views only read the first page. Two causes:
 * - DynamoDB stops a Query at 1 MB of data, so with large posts (items may
 *   be up to 400 KB) a call returns only a few rows, valid or not.
 * - The public list resolvers re-check each row's publishedAt by instant
 *   AFTER DynamoDB has applied `limit` — DynamoDB compares the sort key as a
 *   string, and non-canonical values (e.g. a future `-05:00` publishedAt,
 *   which sorts before now) are dropped by the re-check (#406). Such a
 *   response can be empty.
 *
 * Cost: the first call asks for exactly `limit` with the caller's token.
 * For canonical data it fills the page (or ends the listing), so this is one
 * call; for listPostsByTag the returned `nextToken` is then the raw AppSync
 * token, as before (listPublishedPosts always returns an anchored cursor and
 * adds one small group read per resumed page, see `fillPublishedPage`).
 *
 * Chunk mode: once a response is short while the listing continues, later
 * calls read FILL_CHUNK rows at a time. When a chunk holds more visible
 * posts than the page needs, the returned `nextToken` is a runtime cursor
 * (`ampless-c2.…`): the chunk's start token plus a KEYSET anchor — the sort
 * key of the last returned post and the ids of returned posts sharing that
 * key. The next page re-reads the chunk and drops every post at or before
 * the anchor (key sorting after it, or equal and already returned). Both
 * halves are positions, not counts: an AppSync token wraps a DynamoDB
 * ExclusiveStartKey, which stays valid when that row is deleted, and the
 * anchor is a sort-key value. So posts deleted, unpublished, inserted or
 * becoming live between two page requests do not shift the position. As
 * with any keyset cursor, a post inserted (or becoming live) at a position
 * BEFORE the cursor is not shown on later pages. Any token without the
 * prefix is treated as a raw AppSync token, so tokens from older runtimes
 * keep working.
 *
 * That keyset argument needs a total order. listPostsByTag has one: the
 * PostTag sort key (`publishedAt#postId`) is the table's unique primary
 * key, so its order is DynamoDB primary-key order and this function is used
 * as is. listPublishedPosts does not — the `byStatus` GSI sorts by
 * `publishedAt` alone and DynamoDB documents no order among equal GSI sort
 * keys — so it goes through `fillPublishedPage`, which handles tie groups
 * separately.
 *
 * The sort key is rebuilt from the returned item (`publishedAt`, plus
 * `#postId` for PostTag), which the resolvers return exactly as stored. An
 * item without publishedAt cannot be anchored; then the rest of its chunk
 * is returned with the chunk's raw end token (a page larger than `limit`,
 * never a skipped post) and the oddity is logged.
 *
 * Bound: only EMPTY calls (no new visible post) are budgeted, at
 * MAX_EMPTY_FILL_CALLS per page. Every other call adds at least one post, so
 * a page makes at most `limit + MAX_EMPTY_FILL_CALLS` resolver calls (plus
 * up to MAX_GROUP_READS same-key reads for listPublishedPosts), each
 * reading at most FILL_CHUNK rows and at most 1 MB. Callers cap `limit`
 * (templates use ≤ 50, the public MCP tool clamps to 50, llms.txt pages
 * with its own `pageSizeCap`), which keeps one page's work bounded.
 *
 * Valid data never exhausts the budget: a 1 MB-truncated response still
 * holds at least one row, and for canonical publishedAt values every row
 * the key condition returns is live by instant (lexical order equals
 * chronological order), except rows within the minute of key-bound
 * widening just outside `from` / `to` (list-published-posts.js), of which
 * there are at most a minute's worth. So an empty call means the resolver
 * dropped every row it read — non-canonical future values, unparseable
 * values, or such boundary rows.
 *
 * When the budget runs out while the page is still short and the listing
 * continues, this throws PostListScanLimitError (after logging) instead of
 * returning an incomplete page: a misleading empty / short listing would
 * hide published posts, whereas the error is visible (on force-dynamic
 * pages it surfaces as an error response) and logged. A short page is only
 * ever returned with `nextToken: null`. Paging consumers (llms.txt and the
 * MCP tools via `collectBounded`) just receive fuller pages and keep
 * following `nextToken` as before.
 */
interface FetchArgs {
  limit: number
  nextToken: string | undefined
  /**
   * listPublishedPosts only: read just the posts whose `publishedAt` equals
   * this stored string (passed as both `from` and `to`). The resolver's
   * bounds include every spelling of that instant (#404), and its response
   * keeps only rows at exactly that instant.
   */
  sameKey?: string
}

function visiblePosts(data: PublicPostConnectionShape | null): Post[] {
  return (data?.items ?? []).filter((p): p is PublicPostShape => p !== null).map(toCorePost)
}

async function fillPage(
  operation: ListOperation,
  limit: number,
  nextToken: string | undefined,
  fill: boolean,
  fetchPage: (args: FetchArgs) => Promise<PublicPostConnectionShape | null>
): Promise<ListPostsResult> {
  if (!fill) {
    // One resolver call, raw token: the caller pages and bounds itself.
    // Runtime cursors are never produced here, so none is decoded either.
    const data = await fetchPage({ limit, nextToken })
    return {
      items: (data?.items ?? []).filter((p): p is PublicPostShape => p !== null).map(toCorePost),
      nextToken: data?.nextToken ?? null,
    }
  }
  if (operation === 'listPublishedPosts') return fillPublishedPage(limit, nextToken, fetchPage)
  const items: Post[] = []
  let calls = 0
  let emptyCalls = 0
  const visible = (data: PublicPostConnectionShape | null) =>
    (data?.items ?? []).filter((p): p is PublicPostShape => p !== null).map(toCorePost)

  const resumed = nextToken ? decodeCursor(nextToken) : undefined
  let chunkStart: string | null
  let chunkSize = FILL_CHUNK
  let anchor: Anchor | undefined
  if (resumed) {
    chunkStart = resumed.t
    chunkSize = resumed.c
    anchor = resumed.k === null ? undefined : { k: resumed.k, ids: resumed.ids }
  } else {
    // Fast path: exactly `limit`, caller's token.
    const data = await fetchPage({ limit, nextToken })
    calls++
    items.push(...visible(data))
    if (items.length === 0) emptyCalls++
    const token = data?.nextToken ?? null
    if (items.length >= limit || !token) return { items, nextToken: token }
    chunkStart = token
  }

  /** Not yet returned: after the anchor, or an untaken member of its tie set. */
  const afterAnchor = (post: Post): boolean => {
    if (!anchor) return true
    const key = sortKeyOf(operation, post)
    if (key === undefined) return true
    const cmp = compareKeys(key, anchor.k)
    if (cmp > 0) return false
    if (cmp === 0) return !anchor.ids.includes(post.postId)
    return true
  }

  /** Move the anchor to `post`, which was just returned. */
  const advanceAnchor = (post: Post): boolean => {
    const key = sortKeyOf(operation, post)
    if (key === undefined) return false
    anchor =
      anchor && anchor.k === key
        ? {
            k: key,
            ids: anchor.ids.includes(post.postId) ? anchor.ids : [...anchor.ids, post.postId],
          }
        : { k: key, ids: [post.postId] }
    return true
  }

  // In the fast path's items the anchor starts at the last one returned.
  for (const p of items) advanceAnchor(p)

  // Chunk mode.
  for (;;) {
    if (emptyCalls >= MAX_EMPTY_FILL_CALLS) {
      const cursor = encodeCursor(chunkStart, anchor, chunkSize)
      const err = new PostListScanLimitError(operation, items, cursor, calls, emptyCalls, limit)
      console.error(`[ampless] ${err.message}`, {
        operation,
        limit,
        calls,
        emptyCalls,
        collected: items.length,
      })
      throw err
    }
    const data = await fetchPage({ limit: chunkSize, nextToken: chunkStart ?? undefined })
    calls++
    const chunk = visible(data).filter(afterAnchor)
    if (chunk.length === 0) emptyCalls++
    const token = data?.nextToken ?? null
    const needed = limit - items.length
    if (chunk.length > needed) {
      const taken = chunk.slice(0, needed)
      let anchored = true
      for (const p of taken) anchored = advanceAnchor(p) && anchored
      if (!anchored) {
        console.error(
          `[ampless] ${operation}: a returned post has no publishedAt, so the page cannot be anchored mid-chunk; returning the whole chunk (${items.length + chunk.length} posts) with its end token`
        )
        items.push(...chunk)
        return { items, nextToken: token }
      }
      items.push(...taken)
      return { items, nextToken: encodeCursor(chunkStart, anchor, chunkSize) }
    }
    items.push(...chunk)
    for (const p of chunk) advanceAnchor(p)
    if (items.length >= limit || !token) return { items, nextToken: token }
    chunkStart = token
  }
}

/**
 * `fillPage` for listPublishedPosts, where equal sort keys (posts sharing one
 * exact `publishedAt` string) have no documented order in the `byStatus` GSI
 * and that order may differ between two Query calls.
 *
 * Hazard: a position inside a tie group — an AppSync token whose row is a
 * tie member, or a cursor anchored on one — resumes "strictly after that row
 * in the CURRENT order". If the order changed, unseen members that moved
 * before the position are excluded by DynamoDB before any de-duplication
 * could see them.
 *
 * Strategy: when a tie group may straddle a position, read the WHOLE group in
 * one Query — a same-key range read (`from = to = publishedAt`, see
 * FetchArgs.sameKey) — and take its unreturned members; position-based reads
 * then skip that key entirely. Within one Query the order is consistent, so
 * that read cannot miss a member. A same-key read happens:
 * - when resuming any cursor this function emitted (its anchor group may
 *   continue past it). Cursors always carry the anchor, so every boundary
 *   between two pages is protected whatever the tie order does. Cost: one
 *   extra, small resolver call per resumed page.
 * - inside one fill, at an internal read boundary that ends on a member of
 *   the anchor group, when either two or more members were already seen (a
 *   known tie) or the next read contains another member (observed straddle).
 *
 * If the group itself straddles a page of that read (or the read needs more
 * than MAX_GROUP_READ_PAGES pages), or a page would need more than
 * MAX_GROUP_READS such reads, this throws PostListTieError instead of
 * returning a page that might be incomplete.
 *
 * Remaining gaps, not detected (pinned as KNOWN GAP (#406) tests):
 * - inside one fill, a read ending on the FIRST member seen of a group, where
 *   every unseen member moved before that boundary by the next call: the
 *   next read shows no member, so nothing indicates the group continued.
 * - raw-token paging (`fill: false`, direct AppSync callers) has no anchor at
 *   all; it behaves as on main.
 * - a raw incoming token positioned inside a tie inherits that raw behaviour
 *   for the first read.
 * A unique composite sort key for this index (#406) removes all of these.
 */
async function fillPublishedPage(
  limit: number,
  nextToken: string | undefined,
  fetchPage: (args: FetchArgs) => Promise<PublicPostConnectionShape | null>
): Promise<ListPostsResult> {
  const operation = 'listPublishedPosts'
  const items: Post[] = []
  let calls = 0
  let emptyCalls = 0
  let groupReads = 0
  let anchor: Anchor | undefined
  /** Anchor key whose whole group was read (and fully taken) in this fill. */
  let collected: string | undefined
  const chunkSize = FILL_CHUNK
  const keyOf = (p: Post) => sortKeyOf(operation, p)

  /**
   * `c` = rows for the first resumed read: a chunk when re-reading from a
   * read's start, just the page size when resuming right after a read.
   */
  const cursorAt = (t: string | null, c: number = chunkSize): string => {
    try {
      return encodeCursor(t, anchor, c)
    } catch {
      throw new PostListTieError('too-many-tied-posts', anchor!.k, items, null, calls)
    }
  }

  /** Not returned yet: after the anchor, or an untaken member of its group. */
  const isNew = (post: Post): boolean => {
    if (!anchor) return true
    const key = keyOf(post)
    if (key === undefined) return true
    const cmp = compareKeys(key, anchor.k)
    if (cmp > 0) return false
    if (cmp === 0) return collected !== anchor.k && !anchor.ids.includes(post.postId)
    return true
  }

  const take = (post: Post): void => {
    const key = keyOf(post)
    if (key !== undefined) {
      anchor =
        anchor && anchor.k === key
          ? {
              k: key,
              ids: anchor.ids.includes(post.postId) ? anchor.ids : [...anchor.ids, post.postId],
            }
          : { k: key, ids: [post.postId] }
    }
    items.push(post)
  }

  /**
   * Read every post sharing the anchor key in one Query and take the
   * unreturned ones (up to the page). Returns true when the page is full.
   */
  const readGroup = async (position: string | null): Promise<boolean> => {
    const k = anchor!.k
    if (groupReads >= MAX_GROUP_READS) {
      const err = new PostListTieError('group-read-budget', k, items, cursorAt(position), calls)
      console.error(`[ampless] ${err.message}`, { calls, groupReads })
      throw err
    }
    groupReads++
    // The same-key read covers the key's whole minute (the resolver widens
    // `from`/`to` to the minute), so other posts of that minute may push it
    // past one Query. Follow its own nextToken; this is only unsafe when the
    // tie group itself straddles one of these boundaries (same hazard as
    // above, and nothing left to fall back on) — then fail explicitly.
    const groupRows: Post[] = []
    let groupToken: string | undefined
    let groupEndedInKey = false
    for (let page = 0; ; page++) {
      const tooLarge = () => {
        const err = new PostListTieError('group-too-large', k, items, null, calls)
        console.error(`[ampless] ${err.message}`, { calls, groupReads, page })
        return err
      }
      if (page >= MAX_GROUP_READ_PAGES) throw tooLarge()
      const data = await fetchPage({ limit: FILL_CHUNK, nextToken: groupToken, sameKey: k })
      calls++
      const rows = visiblePosts(data)
      if (groupEndedInKey && rows.some((p) => keyOf(p) === k)) throw tooLarge()
      groupRows.push(...rows)
      groupToken = data?.nextToken ?? undefined
      if (!groupToken) break
      const last = rows[rows.length - 1]
      groupEndedInKey = last !== undefined && keyOf(last) === k
    }
    const members = groupRows.filter((p) => keyOf(p) === k && !anchor!.ids.includes(p.postId))
    for (const p of members) {
      if (items.length >= limit) return true
      take(p)
    }
    collected = k
    return items.length >= limit
  }

  const resumed = nextToken ? decodeCursor(nextToken) : undefined
  let readStart: string | null
  let readLimit: number
  if (resumed) {
    readStart = resumed.t
    readLimit = resumed.c
    anchor = resumed.k === null ? undefined : { k: resumed.k, ids: resumed.ids }
    // The anchor group may continue past the cursor in another order.
    if (anchor && (await readGroup(readStart))) {
      return { items, nextToken: cursorAt(readStart) }
    }
  } else {
    // Fast path: exactly `limit`, the caller's (raw) token.
    readStart = nextToken ?? null
    readLimit = limit
  }

  /** The previous read in this fill ended on a member of the anchor group. */
  let endedInGroup = false
  for (;;) {
    if (emptyCalls >= MAX_EMPTY_FILL_CALLS) {
      const err = new PostListScanLimitError(
        operation,
        items,
        cursorAt(readStart),
        calls,
        emptyCalls,
        limit
      )
      console.error(`[ampless] ${err.message}`, {
        operation,
        limit,
        calls,
        emptyCalls,
        collected: items.length,
      })
      throw err
    }
    const before = items.length
    const data = await fetchPage({ limit: readLimit, nextToken: readStart ?? undefined })
    calls++
    const rows = visiblePosts(data)
    const token = data?.nextToken ?? null

    // Observed straddle: the group continues after an internal boundary,
    // so members may also have moved before it. Read the whole group.
    if (endedInGroup && anchor && rows.some((p) => keyOf(p) === anchor!.k)) {
      if (await readGroup(readStart)) return { items, nextToken: cursorAt(readStart) }
    }

    const candidates = rows.filter(isNew)
    const needed = limit - items.length
    if (candidates.length > needed) {
      const taken = candidates.slice(0, needed)
      if (taken.some((p) => keyOf(p) === undefined)) {
        console.error(
          `[ampless] ${operation}: a returned post has no publishedAt, so the page cannot be anchored mid-chunk; returning the whole chunk (${items.length + candidates.length} posts) with its end token`
        )
        items.push(...candidates)
        return { items, nextToken: token }
      }
      for (const p of taken) take(p)
      return { items, nextToken: cursorAt(readStart) }
    }
    for (const p of candidates) take(p)
    if (items.length === before) emptyCalls++
    if (!token) return { items, nextToken: null }
    if (items.length >= limit) {
      return { items, nextToken: cursorAt(token, Math.min(limit, FILL_CHUNK)) }
    }

    // Internal boundary at `token`.
    const last = rows[rows.length - 1]
    endedInGroup =
      anchor !== undefined && last !== undefined && keyOf(last) === anchor.k && collected !== anchor.k
    if (endedInGroup && anchor!.ids.length >= 2) {
      // A known tie group straddles this boundary: read it whole now.
      if (await readGroup(token)) {
        return { items, nextToken: cursorAt(token, Math.min(limit, FILL_CHUNK)) }
      }
      endedInGroup = false
    }
    readStart = token
    readLimit = chunkSize
  }
}

/**
 * Build the post-fetching API from a user-provided amplify_outputs
 * blob. Uses a stateless Amplify server client: `generateServerClientUsingReqRes`
 * run with `nextServerContext: null` — Amplify's `sharedInMemoryStorage`
 * guest-role path — so public apiKey reads never read or write cookies.
 * This prevents the runtime from writing a Cognito guest identityId
 * Set-Cookie on public route responses (e.g. `/og/[slug]`, `/feed.xml`).
 *
 * authMode is 'apiKey' because Amplify Gen 2 custom handlers
 * (`a.handler.custom`) don't support `allow.guest()` — only apiKey /
 * userPool / lambda / group / owner.
 *
 * Internally we type the client structurally (just `client.queries`
 * with the three methods we use) so the runtime doesn't depend on
 * any specific template's generated Schema. Templates that want
 * end-to-end type safety on those queries can still get it through
 * their own thin wrapper that re-types this API.
 */
export function createPostsApi(outputs: AmplessOutputs): PostsApi {
  const { runWithAmplifyServerContext } = createServerRunner({
    config: outputs as Parameters<typeof createServerRunner>[0]['config'],
  })
  // The adapter's generic is variance-friendly; we ask for a Schema
  // shape it doesn't need to introspect (no models, no custom
  // operations declared) and immediately cast to our structural
  // PublicClient. At runtime the AppSync request shape is identical
  // — the generic only drives type narrowing, which we override here
  // because the runtime is schema-agnostic.
  const client = generateServerClientUsingReqRes({
    config: outputs as Parameters<typeof generateServerClientUsingReqRes>[0]['config'],
    authMode: 'apiKey',
  }) as unknown as PublicClient

  return {
    async listPublishedPosts(opts: ListPostsOptions = {}): Promise<ListPostsResult> {
      const fill = opts.fill ?? true
      return fillPage('listPublishedPosts', opts.limit ?? 20, opts.nextToken, fill, async (args) => {
        const { data, errors } = await runWithAmplifyServerContext({
          nextServerContext: null,
          operation: (contextSpec) =>
            client.queries.listPublishedPosts(contextSpec, {
              from: args.sameKey ?? opts.from,
              to: args.sameKey ?? opts.to,
              limit: args.limit,
              nextToken: args.nextToken,
            }),
        })
        if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts')
        return data
      })
    },

    async getPublishedPost(slug: string): Promise<Post | null> {
      const { data, errors } = await runWithAmplifyServerContext({
        nextServerContext: null,
        operation: (contextSpec) => client.queries.getPublishedPost(contextSpec, { slug }),
      })
      if (errors) throw new Error(errors[0]?.message ?? 'Failed to get post')
      return data ? toCorePost(data) : null
    },

    async listPostsByTag(
      tag: string,
      opts: ListPostsByTagOptions = {}
    ): Promise<ListPostsResult> {
      const fill = opts.fill ?? true
      return fillPage('listPostsByTag', opts.limit ?? 20, opts.nextToken, fill, async (args) => {
        const { data, errors } = await runWithAmplifyServerContext({
          nextServerContext: null,
          operation: (contextSpec) =>
            client.queries.listPostsByTag(contextSpec, {
              tag,
              limit: args.limit,
              nextToken: args.nextToken,
            }),
        })
        if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts by tag')
        return data
      })
    },
  }
}
