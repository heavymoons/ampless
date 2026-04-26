import { generateClient } from 'aws-amplify/api'
import { setPostsProvider, type Post, type PostsProvider, type ListOptions } from 'ampless'
import type { Schema } from '../amplify/data/resource'

type DataPost = Schema['Post']['type']

const client = generateClient<Schema>()

function toCorePost(p: DataPost): Post {
  return {
    postId: p.postId,
    siteId: p.siteId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: (p.format ?? 'markdown') as Post['format'],
    body: p.body,
    status: (p.status ?? 'draft') as Post['status'],
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
  }
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
      body: input.body,
      status: input.status,
      publishedAt: input.publishedAt,
      tags: input.tags,
    })
    if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to create post')
    return toCorePost(data)
  },

  async update(postId, patch, opts = {}) {
    const siteId = opts.siteId ?? 'default'
    const { data, errors } = await client.models.Post.update({
      siteId,
      postId,
      ...(patch.slug !== undefined && { slug: patch.slug }),
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.excerpt !== undefined && { excerpt: patch.excerpt }),
      ...(patch.format !== undefined && { format: patch.format }),
      ...(patch.body !== undefined && { body: patch.body }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.publishedAt !== undefined && { publishedAt: patch.publishedAt }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
    })
    if (errors || !data) throw new Error(errors?.[0]?.message ?? 'Failed to update post')
    return toCorePost(data)
  },

  async remove(postId, opts = {}) {
    const siteId = opts.siteId ?? 'default'
    const { errors } = await client.models.Post.delete({ siteId, postId })
    if (errors) throw new Error(errors[0]?.message ?? 'Failed to delete post')
  },
}

setPostsProvider(provider)
