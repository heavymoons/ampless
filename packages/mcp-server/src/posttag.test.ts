import { describe, it, expect, vi } from 'vitest'
import type { Post } from 'ampless'
import type { GraphqlClient } from './appsync.js'
import { syncPostTags } from './posttag.js'

function makeClient() {
  const calls: { op: string; variables: unknown }[] = []
  const client = {
    query: vi.fn(async (op: string, variables: unknown) => {
      const m = /\b(create|update|delete)PostTag\b/.exec(op)
      calls.push({ op: m ? `${m[1]}PostTag` : op, variables })
      return {} as never
    }),
  } as unknown as GraphqlClient
  return { client, calls }
}

const basePost: Post = {
  postId: 'p1',
  slug: 'hello',
  title: 'Hello',
  excerpt: 'teaser',
  format: 'tiptap',
  body: {},
  status: 'published',
  publishedAt: '2026-04-01T00:00:00.000Z',
  tags: ['tech', 'news'],
}

describe('syncPostTags', () => {
  it('emits create entries for newly published post with tags', async () => {
    const { client, calls } = makeClient()
    await syncPostTags(client, basePost, null)
    const ops = calls.map((c) => c.op)
    expect(ops.filter((o) => o === 'createPostTag')).toHaveLength(2)
    expect(ops).not.toContain('deletePostTag')
  })

  it('emits no calls when both before and after are unpublished', async () => {
    const draft: Post = { ...basePost, status: 'draft', publishedAt: undefined }
    const { client, calls } = makeClient()
    await syncPostTags(client, draft, draft)
    expect(calls).toHaveLength(0)
  })

  it('emits delete entries when a tag is removed', async () => {
    const { client, calls } = makeClient()
    const updated: Post = { ...basePost, tags: ['tech'] }
    await syncPostTags(client, updated, basePost)
    expect(calls.find((c) => c.op === 'deletePostTag')).toBeDefined()
    expect(calls.filter((c) => c.op === 'createPostTag')).toHaveLength(0)
    expect(calls.filter((c) => c.op === 'updatePostTag')).toHaveLength(1)
  })

  it('emits update entries when display fields change but tag set is identical', async () => {
    const { client, calls } = makeClient()
    const renamed: Post = { ...basePost, title: 'Hello Renamed' }
    await syncPostTags(client, renamed, basePost)
    expect(calls.filter((c) => c.op === 'updatePostTag')).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'createPostTag')).toHaveLength(0)
    expect(calls.filter((c) => c.op === 'deletePostTag')).toHaveLength(0)
  })

  it('emits delete entries when a published post becomes a draft', async () => {
    const { client, calls } = makeClient()
    const unpublished: Post = { ...basePost, status: 'draft' }
    await syncPostTags(client, unpublished, basePost)
    expect(calls.filter((c) => c.op === 'deletePostTag')).toHaveLength(2)
  })

  it('handles add + remove in a single update', async () => {
    const { client, calls } = makeClient()
    const swapped: Post = { ...basePost, tags: ['tech', 'opinion'] }
    await syncPostTags(client, swapped, basePost)
    expect(calls.filter((c) => c.op === 'deletePostTag')).toHaveLength(1)
    expect(calls.filter((c) => c.op === 'createPostTag')).toHaveLength(1)
    expect(calls.filter((c) => c.op === 'updatePostTag')).toHaveLength(1)
  })
})
