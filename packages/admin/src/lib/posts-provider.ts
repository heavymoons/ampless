'use client'

import { generateClient } from 'aws-amplify/api'
import {
  setPostsProvider,
  decodeAwsJson,
  encodeAwsJson,
  type Post,
  type PostMetadata,
  type PostsProvider,
  type ListOptions,
  type CreatePostInput,
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
// PostTag is kept as a denormalized "posts by tag" index, maintained
// from the admin client whenever a post's tags or publish state change.

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
}

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface ListResult<T> {
  data: T[]
  errors?: Array<{ message?: string }> | null
}

interface PostModel {
  list(args?: {
    filter?: Record<string, unknown>
    limit?: number
  }): Promise<ListResult<DataPostRow>>
  get(args: { postId: string }): Promise<ModelResult<DataPostRow>>
  create(args: Record<string, unknown>): Promise<ModelResult<DataPostRow>>
  update(args: Record<string, unknown>): Promise<ModelResult<DataPostRow>>
  delete(args: { postId: string }): Promise<ModelResult<DataPostRow>>
}

interface PostTagModel {
  create(args: Record<string, unknown>): Promise<ModelResult<unknown>>
  update(args: Record<string, unknown>): Promise<ModelResult<unknown>>
  delete(args: {
    tag: string
    publishedAtPostId: string
  }): Promise<ModelResult<unknown>>
}

interface DataClient {
  models: {
    Post: PostModel
    PostTag: PostTagModel
  }
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
  }
}

interface PostTagEntry {
  tag: string
  publishedAtPostId: string
}

function postTagEntries(post: Post): PostTagEntry[] {
  if (post.status !== 'published' || !post.publishedAt || !post.tags?.length) return []
  return post.tags.map((tag) => ({
    tag,
    publishedAtPostId: `${post.publishedAt}#${post.postId}`,
  }))
}

function entryKey(e: PostTagEntry): string {
  return `${e.tag}|${e.publishedAtPostId}`
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

  async function syncPostTags(post: Post, oldPost: Post | null): Promise<void> {
    const oldEntries = oldPost ? postTagEntries(oldPost) : []
    const newEntries = postTagEntries(post)

    const oldKeys = new Set(oldEntries.map(entryKey))
    const newKeys = new Set(newEntries.map(entryKey))

    function fullRow(e: PostTagEntry) {
      return {
        tag: e.tag,
        publishedAtPostId: e.publishedAtPostId,
        postId: post.postId,
        publishedAt: post.publishedAt!,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        tags: post.tags ?? [],
      }
    }

    // Upsert: try update first, fall back to create on ConditionalCheckFailed.
    // We can't trust oldKeys alone because legacy posts published before the
    // PostTag denormalized index existed have no rows in DynamoDB even though
    // oldPost.tags suggests they should — AppSync's `update` would otherwise
    // fail with `attribute_exists` not satisfied.
    //
    // Also covers the reverse: if a row was somehow orphaned (post deleted
    // but PostTag not), a `create` finds the existing PK → fall back to update.
    async function upsertPostTag(e: PostTagEntry) {
      const row = fullRow(e)
      const upd = await client.models.PostTag.update(row)
      if (!upd.errors) return
      // AppSync surfaces DynamoDB ConditionalCheckFailedException as an error
      // with `errorType: 'DynamoDB:ConditionalCheckFailedException'` or a
      // message containing "conditional request failed". Either way, the
      // safest reaction is to fall back to create.
      const cre = await client.models.PostTag.create(row)
      if (cre.errors) {
        // If create also failed conditionally (row exists but update couldn't
        // touch it — auth?), surface the original update error.
        throw new Error(upd.errors[0]?.message ?? 'PostTag.update failed')
      }
    }

    // Remove entries that no longer apply (tag removed, unpublished, etc.).
    await Promise.all(
      oldEntries
        .filter((e) => !newKeys.has(entryKey(e)))
        .map((e) => client.models.PostTag.delete(e))
    )

    // Add brand-new entries (tag added, just published, etc.). Try create
    // first; on conditional fail (orphan row left over), fall through to
    // update.
    await Promise.all(
      newEntries
        .filter((e) => !oldKeys.has(entryKey(e)))
        .map(async (e) => {
          const cre = await client.models.PostTag.create(fullRow(e))
          if (!cre.errors) return
          const upd = await client.models.PostTag.update(fullRow(e))
          if (upd.errors)
            throw new Error(cre.errors[0]?.message ?? 'PostTag.create failed')
        })
    )

    // Update entries whose key didn't change but display fields might have
    // (title/slug/excerpt/tags). Use upsert to tolerate legacy posts where
    // PostTag rows were never created.
    await Promise.all(
      newEntries.filter((e) => oldKeys.has(entryKey(e))).map(upsertPostTag)
    )
  }

  const provider: PostsProvider = {
    async list(opts: ListOptions = {}) {
      const status = opts.status ?? 'published'
      const filter: Record<string, unknown> = {}
      if (status !== 'all') filter.status = { eq: status }
      const hasFilter = Object.keys(filter).length > 0
      const { data } = await client.models.Post.list({
        filter: hasFilter ? filter : undefined,
        limit: opts.limit ?? 100,
      })
      return data.map(toCorePost)
    },

    async get(slug) {
      const { data } = await client.models.Post.list({
        filter: { slug: { eq: slug } },
        limit: 1,
      })
      return data[0] ? toCorePost(data[0]) : null
    },

    async getById(postId) {
      const { data } = await client.models.Post.get({ postId })
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
      const created = toCorePost(data)
      await syncPostTags(created, null)
      return created
    },

    async update(postId, patch) {
      // Need the previous post snapshot to diff PostTag entries correctly.
      const oldPost = await this.getById(postId)

      const { data, errors } = await client.models.Post.update({
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
      })
      if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to update post')
      const updated = toCorePost(data)
      await syncPostTags(updated, oldPost)
      return updated
    },

    async remove(postId) {
      // Drop PostTag entries before the post itself disappears.
      const oldPost = await this.getById(postId)
      if (oldPost) {
        await syncPostTags({ ...oldPost, status: 'draft' }, oldPost)
      }
      const { errors } = await client.models.Post.delete({ postId })
      if (errors) throw new Error(errors[0]?.message ?? 'Failed to delete post')
    },
  }

  setPostsProvider(provider)
}
