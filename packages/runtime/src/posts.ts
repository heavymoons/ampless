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
}

export interface ListPostsByTagOptions {
  limit?: number
  nextToken?: string
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
 * Most resolver calls made to fill one page (see `fillPage`). With the
 * first call plus 19 chunks of FILL_CHUNK this tolerates ~1,900 dropped
 * index rows ahead of the page before failing explicitly.
 */
const MAX_FILL_CALLS = 20

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
 * Thrown when a list page could not be filled within MAX_FILL_CALLS
 * resolver calls while the listing still continues. Rather than return a
 * short (possibly empty) page that first-page-only views (home, tag pages)
 * would render as "no posts", the failure is explicit. `items` holds what
 * was collected and `nextToken` resumes the scan right after it.
 */
export class PostListScanLimitError extends Error {
  readonly operation: ListOperation
  readonly items: Post[]
  readonly nextToken: string
  readonly calls: number

  constructor(
    operation: ListOperation,
    items: Post[],
    nextToken: string,
    calls: number,
    limit: number
  ) {
    super(
      `${operation}: page has ${items.length}/${limit} posts after ${calls} resolver calls and the listing continues; too many index rows were dropped (non-canonical publishedAt, see #406)`
    )
    this.name = 'PostListScanLimitError'
    this.operation = operation
    this.items = items
    this.nextToken = nextToken
    this.calls = calls
  }
}

/**
 * Collect up to `limit` posts from a list resolver, following `nextToken`.
 *
 * Why: the public list resolvers re-check each row's publishedAt by instant
 * AFTER DynamoDB has applied `limit` — DynamoDB compares the sort key as a
 * string, and non-canonical values (e.g. a future `-05:00` publishedAt,
 * which sorts before now) are dropped by the re-check (#406). One response
 * can therefore be short, even empty, while `nextToken` is still set, and
 * the home / tag views only read the first page.
 *
 * Cost: the first call asks for exactly `limit` with the caller's token.
 * For canonical data it fills the page (or ends the listing), so this is one
 * call and the returned `nextToken` is the raw AppSync token, as before.
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
 * becoming live between two page requests never shift the position — no
 * post after the cursor is skipped or repeated. As with any keyset cursor,
 * a post inserted (or becoming live) at a position BEFORE the cursor is
 * not shown on later pages. Equal sort keys (the GSI orders ties in no
 * documented way) are handled by the tie id set, not by their order. Any
 * token without the prefix is treated as a raw AppSync token, so tokens
 * from older runtimes keep working.
 *
 * The sort key is rebuilt from the returned item (`publishedAt`, plus
 * `#postId` for PostTag), which the resolvers return exactly as stored. An
 * item without publishedAt cannot be anchored; then the rest of its chunk
 * is returned with the chunk's raw end token (a page larger than `limit`,
 * never a skipped post) and the oddity is logged.
 *
 * Bound: at most MAX_FILL_CALLS resolver calls per page. If the page is
 * still short and the listing continues, this throws PostListScanLimitError
 * (after logging) instead of returning an incomplete page: a misleading
 * empty / short listing would hide published posts, whereas the error is
 * visible (on force-dynamic pages it surfaces as an error response) and
 * logged. A short page is only ever returned with `nextToken: null`.
 */
async function fillPage(
  operation: ListOperation,
  limit: number,
  nextToken: string | undefined,
  fetchPage: (args: {
    limit: number
    nextToken: string | undefined
  }) => Promise<PublicPostConnectionShape | null>
): Promise<ListPostsResult> {
  const items: Post[] = []
  let calls = 0
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
    if (calls >= MAX_FILL_CALLS) {
      const cursor = encodeCursor(chunkStart, anchor, chunkSize)
      const err = new PostListScanLimitError(operation, items, cursor, calls, limit)
      console.error(`[ampless] ${err.message}`, { operation, limit, calls, collected: items.length })
      throw err
    }
    const data = await fetchPage({ limit: chunkSize, nextToken: chunkStart ?? undefined })
    calls++
    const chunk = visible(data).filter(afterAnchor)
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
      return fillPage('listPublishedPosts', opts.limit ?? 20, opts.nextToken, async (args) => {
        const { data, errors } = await runWithAmplifyServerContext({
          nextServerContext: null,
          operation: (contextSpec) =>
            client.queries.listPublishedPosts(contextSpec, {
              from: opts.from,
              to: opts.to,
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
      return fillPage('listPostsByTag', opts.limit ?? 20, opts.nextToken, async (args) => {
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
