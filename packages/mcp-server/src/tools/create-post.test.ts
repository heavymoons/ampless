import { describe, it, expect, vi } from 'vitest'

// Mock `ampless` so this test runs without a built package (same style as
// update-post.test.ts).
vi.mock('ampless', () => ({
  isValidCustomClassId: (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[a-z0-9-]+$/.test(id),
  normalizePostClasses: (v: unknown) =>
    Array.isArray(v)
      ? v.filter((id, i) => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && v.indexOf(id) === i)
      : [],
  encodeAwsJson: (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)),
  decodeAwsJson: (v: unknown) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v)
      } catch {
        return v
      }
    }
    return v
  },
}))

import { createPost } from './create-post.js'
import type { GraphqlClient } from './types.js'

interface Call {
  op: string
  vars: Record<string, unknown> | undefined
}

function makeGraphql(): { graphql: GraphqlClient; calls: Call[] } {
  const calls: Call[] = []
  return {
    graphql: {
      async query(op: string, vars?: Record<string, unknown>) {
        calls.push({ op, vars })
        const input = (vars as { input: Record<string, unknown> }).input
        return { createPost: { ...input, tags: input.tags ?? [] } }
      },
    } as GraphqlClient,
    calls,
  }
}

const base = { slug: 'hello', title: 'Hello', format: 'markdown' as const, body: 'hi' }
const input = (calls: Call[]) => (calls.at(-1)!.vars as { input: Record<string, unknown> }).input

describe('createPost — postClasses', () => {
  it('writes the top-level postClasses into metadata (de-duplicated)', async () => {
    const { graphql, calls } = makeGraphql()
    const post = await createPost(graphql, { ...base, postClasses: ['wide', 'serif', 'wide'] })
    expect(JSON.parse(input(calls).metadata as string)).toEqual({ postClasses: ['wide', 'serif'] })
    expect(post.metadata).toEqual({ postClasses: ['wide', 'serif'] })
  })

  it('merges with the supplied metadata, keeping other keys; the top-level list wins', async () => {
    const { graphql, calls } = makeGraphql()
    await createPost(graphql, {
      ...base,
      metadata: { cache: 'deep', seo: { title: 'X' }, postClasses: ['old'] },
      postClasses: ['wide'],
    })
    expect(JSON.parse(input(calls).metadata as string)).toEqual({
      cache: 'deep',
      seo: { title: 'X' },
      postClasses: ['wide'],
    })
  })

  it('an empty list stores no postClasses key and no empty metadata object', async () => {
    const { graphql, calls } = makeGraphql()
    await createPost(graphql, { ...base, postClasses: [] })
    expect(input(calls).metadata).toBeUndefined()

    await createPost(graphql, { ...base, metadata: { cache: 'hot', postClasses: ['wide'] }, postClasses: [] })
    expect(JSON.parse(input(calls).metadata as string)).toEqual({ cache: 'hot' })
  })

  it('leaves metadata untouched when postClasses is omitted', async () => {
    const { graphql, calls } = makeGraphql()
    await createPost(graphql, base)
    expect(input(calls).metadata).toBeUndefined()
  })

  it('rejects invalid ids with an error naming them, without writing', async () => {
    const { graphql, calls } = makeGraphql()
    await expect(createPost(graphql, { ...base, postClasses: ['ok', 'Not OK'] })).rejects.toThrow(
      /Invalid postClasses id\(s\): "Not OK"/,
    )
    await expect(
      createPost(graphql, { ...base, metadata: { postClasses: ['x" onmouseover='] } }),
    ).rejects.toThrow(/Invalid metadata.postClasses id\(s\)/)
    await expect(
      createPost(graphql, { ...base, metadata: { postClasses: 'wide' } }),
    ).rejects.toThrow(/metadata.postClasses must be an array/)
    expect(calls).toHaveLength(0)
  })
})
