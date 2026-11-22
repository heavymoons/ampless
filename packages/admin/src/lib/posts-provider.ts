'use client'

import { generateClient } from 'aws-amplify/api'
import {
  setPostsProvider,
  PostUpdateConflictError,
  decodeAwsJson,
  encodeAwsJson,
  type Post,
  type PostMetadata,
  type PostsProvider,
  type ListOptions,
  type CreatePostInput,
  type PostRevision,
  type ListPostHistoryOptions,
  type PostRevisionConnection,
  type PostSummary,
  type SummaryListOptions,
} from 'ampless'

// Structural shape of the AppSync data client surface admin needs. The
// generated `Schema` lives in the user's project (amplify/data/resource.ts);
// admin stays schema-agnostic by typing the client by capability instead
// of by Schema generic — same trick the runtime uses for the public-side
// `client.queries`. Templates with stricter typing can still narrow on
// their own side by inferring `Schema['Post']['type']`, but the admin
// package compiles without depending on any particular template's
// schema definition.
//
// PostTag (the denormalized "posts by tag" index) is maintained by the
// trusted-processor Lambda directly off the Post DynamoDB stream —
// admin writes Post and gets PostTag for free, no client-side sync.
// See packages/backend/src/events/processor-trusted.ts
// `rebuildPostTagsForPost`.

interface DataPostRow {
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
  // DynamoDB auto-managed timestamp. Amplify Gen 2 populates it on every
  // write and returns it on the row. We surface it so the editor's
  // localStorage draft recovery can anchor a draft to the server version
  // it was based on (`Post.updatedAt`) and detect a stale draft.
  updatedAt?: string | null
}

// The PostHistory snapshot row as read back through AppSync. Written by
// the event-dispatcher Lambda on each Post INSERT/MODIFY (see
// packages/backend/src/events/dispatcher.ts `writePostHistory`). `body`
// and `metadata` are AWSJSON scalars, same as the Post row.
interface DataPostHistoryRow {
  postHistoryId: string
  postId: string
  revisedAt: string
  title?: string | null
  slug?: string | null
  excerpt?: string | null
  format?: string | null
  body?: unknown
  status?: string | null
  publishedAt?: string | null
  tags?: Array<string | null> | null
  metadata?: unknown
}

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

// Connection result for the `byPost` GSI query. Amplify returns
// `nextToken: string | null`; we normalise to `string | undefined` at
// the provider boundary so the public connection type stays clean.
interface ConnectionResult<T> {
  data: T[]
  nextToken?: string | null
  errors?: Array<{ message?: string }> | null
}

interface PostModel {
  list(args?: {
    filter?: Record<string, unknown>
    limit?: number
    nextToken?: string | null
    selectionSet?: readonly string[]
  }): Promise<ConnectionResult<DataPostRow>>
  get(args: { postId: string }): Promise<ModelResult<DataPostRow>>
  create(args: Record<string, unknown>): Promise<ModelResult<DataPostRow>>
  update(args: Record<string, unknown>): Promise<ModelResult<DataPostRow>>
  delete(args: { postId: string }): Promise<ModelResult<DataPostRow>>
}

// Read-only surface for the PostHistory `byPost` GSI. The generated
// method name comes from the schema's `.queryField('listByPost')`
// (packages/backend/src/data/index.ts) — admin/editor can read it
// through AppSync but never write it.
interface PostHistoryModel {
  listByPost(
    args: { postId: string },
    options?: {
      sortDirection?: 'ASC' | 'DESC'
      limit?: number
      nextToken?: string
    }
  ): Promise<ConnectionResult<DataPostHistoryRow>>
}

// One GraphQL error as AppSync reports it. A DynamoDB conditional-write
// rejection carries `errorType: 'DynamoDB:ConditionalCheckFailedException'`
// and a message like "The conditional request failed".
interface GraphqlError {
  message?: string
  errorType?: string | null
}

interface DataClient {
  models: {
    Post: PostModel
    PostHistory: PostHistoryModel
  }
  // Raw GraphQL, for the one write `client.models` cannot express: a
  // conditional `updatePost` (model `update` takes no `condition`). On
  // GraphQL errors amplify rejects with the `{ data, errors }` result
  // itself; a resolved result may also carry `errors`.
  graphql(args: {
    query: string
    variables?: Record<string, unknown>
  }): Promise<{ data?: Record<string, unknown> | null; errors?: GraphqlError[] | null }>
}

// `updatePost` with a mutation condition, selecting every field
// `toCorePost` reads (same as the model client's default row).
const CONDITIONAL_UPDATE_POST = /* GraphQL */ `
  mutation UpdatePost($input: UpdatePostInput!, $condition: ModelPostConditionInput) {
    updatePost(input: $input, condition: $condition) {
      postId
      slug
      title
      excerpt
      format
      body
      status
      publishedAt
      tags
      metadata
      updatedAt
    }
  }
`

function isConditionalCheckFailed(errors: ReadonlyArray<GraphqlError> | null | undefined): boolean {
  return (errors ?? []).some(
    (e) =>
      (typeof e?.errorType === 'string' && e.errorType.includes('ConditionalCheckFailedException')) ||
      (typeof e?.message === 'string' &&
        (e.message.includes('ConditionalCheckFailedException') ||
          e.message.includes('The conditional request failed')))
  )
}

// The GraphQL errors of a rejected `client.graphql` call: amplify rejects
// with the `{ errors }` result; anything else (network failure, a plain
// Error) has none.
function graphqlErrorsOf(err: unknown): GraphqlError[] | undefined {
  const errors = (err as { errors?: unknown } | null)?.errors
  return Array.isArray(errors) ? (errors as GraphqlError[]) : undefined
}

// Body and metadata fields are AWSJSON scalars on the wire. The
// shared `encodeAwsJson` / `decodeAwsJson` helpers in `ampless`
// enforce the JSON-string-on-the-wire rule for every callsite across
// the monorepo — see `packages/ampless/src/awsjson.ts` for the rationale.
function decodeMetadata(value: unknown): PostMetadata | undefined {
  if (value === null || value === undefined) return undefined
  const parsed = decodeAwsJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as PostMetadata)
    : undefined
}

function toCorePost(p: DataPostRow): Post {
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

function toSummary(p: DataPostRow): PostSummary {
  return {
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    status: (p.status ?? 'draft') as PostSummary['status'],
    publishedAt: p.publishedAt ?? undefined,
    updatedAt: p.updatedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
}

// Map a raw PostHistory row to the in-memory `PostRevision` snapshot
// shape. `body` is decoded from AWSJSON to match `Post['body']` for the
// declared format (same decode path as `toCorePost`).
function toCoreRevision(r: DataPostHistoryRow): PostRevision {
  return {
    postHistoryId: r.postHistoryId,
    postId: r.postId,
    revisedAt: r.revisedAt,
    title: r.title ?? undefined,
    slug: r.slug ?? undefined,
    excerpt: r.excerpt ?? undefined,
    format: (r.format ?? undefined) as PostRevision['format'],
    body: decodeAwsJson(r.body),
    status: (r.status ?? undefined) as PostRevision['status'],
    publishedAt: r.publishedAt ?? undefined,
    tags: (r.tags ?? []).filter((t): t is string => typeof t === 'string'),
    metadata: decodeMetadata(r.metadata),
  }
}

let installed = false

/**
 * Install the admin posts-provider into ampless's global registry. Idempotent
 * — only the first call wires the provider; subsequent calls no-op. Invoked
 * by the admin layout factory so every admin client component (which imports
 * `listPosts` etc. from 'ampless') hits this provider.
 */
export function installAdminPostsProvider(): void {
  if (installed) return
  installed = true

  const client = generateClient() as unknown as DataClient

  const provider: PostsProvider = {
    async list(opts: ListOptions = {}) {
      const status = opts.status ?? 'published'
      const filter: Record<string, unknown> = {}
      if (status !== 'all') filter.status = { eq: status }
      const hasFilter = Object.keys(filter).length > 0
      const { data, errors } = await client.models.Post.list({
        filter: hasFilter ? filter : undefined,
        limit: opts.limit ?? 100,
      })
      if (errors && errors.length > 0) {
        console.error('[ampless admin] Post.list failed:', errors)
        throw new Error(errors[0]?.message ?? 'Post.list failed')
      }
      return data.map(toCorePost)
    },

    async listSummaries(opts: SummaryListOptions = {}) {
      const status = opts.status ?? 'all'
      const filter = status !== 'all' ? { status: { eq: status } } : undefined
      const out: PostSummary[] = []
      let nextToken: string | null | undefined = undefined

      do {
        const { data, errors, nextToken: nt } = await client.models.Post.list({
          filter,
          limit: 200,
          nextToken,
          selectionSet: [
            'postId',
            'slug',
            'title',
            'excerpt',
            'status',
            'publishedAt',
            'updatedAt',
            'tags',
          ],
        })
        if (errors && errors.length > 0) {
          console.error('[ampless admin] Post.list page failed:', errors)
          throw new Error(errors[0]?.message ?? 'Post.list failed')
        }
        out.push(...data.map(toSummary))
        nextToken = nt
      } while (nextToken)

      return out
    },

    async get(slug) {
      const { data, errors } = await client.models.Post.list({
        filter: { slug: { eq: slug } },
        limit: 1,
      })
      if (errors && errors.length > 0) {
        console.error('[ampless admin] Post.get (by slug) failed:', errors)
        throw new Error(errors[0]?.message ?? 'Post.get failed')
      }
      return data[0] ? toCorePost(data[0]) : null
    },

    async getById(postId) {
      const { data, errors } = await client.models.Post.get({ postId })
      if (errors && errors.length > 0) {
        console.error('[ampless admin] Post.get failed:', errors)
        throw new Error(errors[0]?.message ?? 'Post.get failed')
      }
      return data ? toCorePost(data) : null
    },

    async create(input: CreatePostInput) {
      const postId =
        input.postId ?? `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const { data, errors } = await client.models.Post.create({
        postId,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        format: input.format,
        body: encodeAwsJson(input.body),
        status: input.status,
        publishedAt: input.publishedAt,
        tags: input.tags,
        ...(input.metadata !== undefined && { metadata: encodeAwsJson(input.metadata) }),
      })
      if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to create post')
      return toCorePost(data)
    },

    async update(postId, patch, options) {
      const input = {
        postId,
        ...(patch.slug !== undefined && { slug: patch.slug }),
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.excerpt !== undefined && { excerpt: patch.excerpt }),
        ...(patch.format !== undefined && { format: patch.format }),
        ...(patch.body !== undefined && { body: encodeAwsJson(patch.body) }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.publishedAt !== undefined && { publishedAt: patch.publishedAt }),
        ...(patch.tags !== undefined && { tags: patch.tags }),
        ...(patch.metadata !== undefined && { metadata: encodeAwsJson(patch.metadata) }),
      }
      if (options?.expectedUpdatedAt === undefined) {
        const { data, errors } = await client.models.Post.update(input)
        if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to update post')
        return toCorePost(data)
      }

      // Compare-and-swap on `updatedAt`: AppSync rejects the write when the
      // row changed since the caller read it (or, for `null`, when the row
      // has an `updatedAt` at all).
      const expected = options.expectedUpdatedAt
      const condition =
        expected === null
          ? { updatedAt: { attributeExists: false } }
          : { updatedAt: { eq: expected } }
      let result: Awaited<ReturnType<DataClient['graphql']>>
      try {
        result = await client.graphql({
          query: CONDITIONAL_UPDATE_POST,
          variables: { input, condition },
        })
      } catch (err) {
        const errors = graphqlErrorsOf(err)
        if (isConditionalCheckFailed(errors)) throw new PostUpdateConflictError()
        console.error('[ampless admin] conditional updatePost failed:', errors ?? err)
        if (errors) throw new Error(errors[0]?.message ?? 'Failed to update post')
        throw err
      }
      const { errors } = result
      if (isConditionalCheckFailed(errors)) throw new PostUpdateConflictError()
      const data = result.data?.updatePost as DataPostRow | null | undefined
      if ((errors && errors.length > 0) || !data) {
        console.error('[ampless admin] conditional updatePost failed:', errors)
        throw new Error(errors?.[0]?.message ?? 'Failed to update post')
      }
      return toCorePost(data)
    },

    async remove(postId) {
      const { errors } = await client.models.Post.delete({ postId })
      if (errors) throw new Error(errors[0]?.message ?? 'Failed to delete post')
    },

    async listPostHistory(
      postId: string,
      options?: ListPostHistoryOptions
    ): Promise<PostRevisionConnection> {
      const { data, nextToken, errors } = await client.models.PostHistory.listByPost(
        { postId },
        {
          sortDirection: 'DESC',
          limit: options?.limit,
          nextToken: options?.nextToken,
        }
      )
      if (errors) {
        throw new Error(errors[0]?.message ?? 'Failed to list post history')
      }
      return {
        items: (data ?? []).map(toCoreRevision),
        // Amplify returns `string | null`; the public type is
        // `string | undefined`.
        nextToken: nextToken ?? undefined,
      }
    },
  }

  setPostsProvider(provider)
}
