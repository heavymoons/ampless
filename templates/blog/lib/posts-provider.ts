import { generateClient } from 'aws-amplify/api'
import { setPostsProvider, type Post, type PostsProvider, type ListOptions } from 'ampless'
import type { Schema } from '../amplify/data/resource'

type DataPost = Schema['Post']['type']

const client = generateClient<Schema>()

// AppSync's AWSJSON scalar requires a JSON-encoded string on the wire.
// We always send/receive strings and parse on the way back into the app.
function encodeBody(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? null)
}

function decodeBody(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function toCorePost(p: DataPost): Post {
  return {
    postId: p.postId,
    siteId: p.siteId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: (p.format ?? 'markdown') as Post['format'],
    body: decodeBody(p.body),
    status: (p.status ?? 'draft') as Post['status'],
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
}

// --- PostTag (denormalized "posts by tag" index) ---
// Maintained from the admin client whenever a post's tags or publish state
// change. Each (siteId, tag, post) combination becomes one row, keyed by:
//   PK: `${siteId}#${tag}`
//   SK: `${publishedAt}#${postId}`
// so the public `listPostsByTag` resolver can do a single Query for a
// tag's newest posts.

interface PostTagEntry {
  siteIdTag: string
  publishedAtPostId: string
}

function postTagEntries(post: Post): PostTagEntry[] {
  if (post.status !== 'published' || !post.publishedAt || !post.tags?.length) return []
  return post.tags.map((tag) => ({
    siteIdTag: `${post.siteId}#${tag}`,
    publishedAtPostId: `${post.publishedAt}#${post.postId}`,
  }))
}

function entryKey(e: PostTagEntry): string {
  return `${e.siteIdTag}|${e.publishedAtPostId}`
}

async function syncPostTags(post: Post, oldPost: Post | null): Promise<void> {
  const oldEntries = oldPost ? postTagEntries(oldPost) : []
  const newEntries = postTagEntries(post)

  const oldKeys = new Set(oldEntries.map(entryKey))
  const newKeys = new Set(newEntries.map(entryKey))

  // Remove entries that no longer apply (tag removed, unpublished, etc.).
  await Promise.all(
    oldEntries
      .filter((e) => !newKeys.has(entryKey(e)))
      .map((e) => client.models.PostTag.delete(e))
  )

  // Add brand-new entries (tag added, just published, etc.).
  await Promise.all(
    newEntries
      .filter((e) => !oldKeys.has(entryKey(e)))
      .map((e) =>
        client.models.PostTag.create({
          siteIdTag: e.siteIdTag,
          publishedAtPostId: e.publishedAtPostId,
          siteId: post.siteId,
          tag: e.siteIdTag.slice(post.siteId.length + 1),
          postId: post.postId,
          publishedAt: post.publishedAt!,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          tags: post.tags ?? [],
        })
      )
  )

  // Update entries whose key didn't change but display fields might have
  // (title/slug/excerpt/tags). DynamoDB upserts fields on update.
  await Promise.all(
    newEntries
      .filter((e) => oldKeys.has(entryKey(e)))
      .map((e) =>
        client.models.PostTag.update({
          siteIdTag: e.siteIdTag,
          publishedAtPostId: e.publishedAtPostId,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          tags: post.tags ?? [],
        })
      )
  )
}

const provider: PostsProvider = {
  async list(opts: ListOptions = {}) {
    const siteId = opts.siteId ?? 'default'
    const status = opts.status ?? 'published'
    const filter: Record<string, unknown> = { siteId: { eq: siteId } }
    if (status !== 'all') filter.status = { eq: status }
    const { data } = await client.models.Post.list({ filter, limit: opts.limit ?? 100 })
    return data.map(toCorePost)
  },

  async get(slug, opts = {}) {
    const siteId = opts.siteId ?? 'default'
    const { data } = await client.models.Post.list({
      filter: { siteId: { eq: siteId }, slug: { eq: slug } },
      limit: 1,
    })
    return data[0] ? toCorePost(data[0]) : null
  },

  async getById(postId, opts = {}) {
    const siteId = opts.siteId ?? 'default'
    const { data } = await client.models.Post.get({ siteId, postId })
    return data ? toCorePost(data) : null
  },

  async create(input) {
    const postId = input.postId ?? `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { data, errors } = await client.models.Post.create({
      siteId: input.siteId,
      postId,
      slug: input.slug,
      title: input.title,
      excerpt: input.excerpt,
      format: input.format,
      body: encodeBody(input.body),
      status: input.status,
      publishedAt: input.publishedAt,
      tags: input.tags,
    })
    if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to create post')
    const created = toCorePost(data)
    await syncPostTags(created, null)
    return created
  },

  async update(postId, patch, opts = {}) {
    const siteId = opts.siteId ?? 'default'
    // Need the previous post snapshot to diff PostTag entries correctly.
    const oldPost = await this.getById(postId, { siteId })

    const { data, errors } = await client.models.Post.update({
      siteId,
      postId,
      ...(patch.slug !== undefined && { slug: patch.slug }),
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.excerpt !== undefined && { excerpt: patch.excerpt }),
      ...(patch.format !== undefined && { format: patch.format }),
      ...(patch.body !== undefined && { body: encodeBody(patch.body) }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.publishedAt !== undefined && { publishedAt: patch.publishedAt }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
    })
    if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to update post')
    const updated = toCorePost(data)
    await syncPostTags(updated, oldPost)
    return updated
  },

  async remove(postId, opts = {}) {
    const siteId = opts.siteId ?? 'default'
    // Drop PostTag entries before the post itself disappears.
    const oldPost = await this.getById(postId, { siteId })
    if (oldPost) {
      await syncPostTags({ ...oldPost, status: 'draft' }, oldPost)
    }
    const { errors } = await client.models.Post.delete({ siteId, postId })
    if (errors) throw new Error(errors[0]?.message ?? 'Failed to delete post')
  },
}

setPostsProvider(provider)
