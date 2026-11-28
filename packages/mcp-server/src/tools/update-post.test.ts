import { describe, it, expect, vi } from 'vitest'

// Pin the AWSJSON helpers; everything else (post-class validation) is the
// real `ampless` (built before tests — turbo `test` depends on `^build`).
vi.mock('ampless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ampless')>()),
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

import { updatePost } from './update-post.js'
import { toCorePost } from './post-mapping.js'
import { postVersion } from './post-version.js'
import type { GraphqlClient } from './types.js'

// ---------------------------------------------------------------------------
// Minimal GraphQL client mock
// ---------------------------------------------------------------------------

interface Call {
  op: string
  vars: Record<string, unknown> | undefined
}

/**
 * Build a GraphqlClient mock that records every call and dispatches to
 * `getResult` for read operations and `mutateResult` for mutations.
 */
function makeGraphql(
  getResult: unknown,
  mutateResult: unknown,
): { graphql: GraphqlClient; calls: Call[] } {
  const calls: Call[] = []
  return {
    graphql: {
      async query(op: string, vars?: Record<string, unknown>) {
        calls.push({ op, vars })
        if (op.includes('getPost') || op.includes('GetPost') || op.includes('listPosts'))
          return getResult
        if (op.includes('updatePost')) return mutateResult
        return {}
      },
    } as GraphqlClient,
    calls,
  }
}

// Existing row with NO publishedAt (draft about to be published).
const existingDraftPost = {
  getPost: {
    postId: 'post-123',
    slug: 'my-post',
    title: 'My Post',
    format: 'markdown',
    body: '"hello"',
    status: 'draft',
    publishedAt: null,
    tags: [],
  },
}

// Existing post that already carries a publishedAt.
const existingPublishedPost = {
  getPost: {
    postId: 'post-123',
    slug: 'my-post',
    title: 'My Post',
    format: 'markdown',
    body: '"hello"',
    status: 'published',
    publishedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
  },
}

const updatedPostResult = {
  updatePost: {
    postId: 'post-123',
    slug: 'my-post',
    title: 'My Post',
    format: 'markdown',
    body: '"hello"',
    status: 'published',
    publishedAt: '2026-06-04T12:00:00.000Z',
    tags: [],
  },
}

// ---------------------------------------------------------------------------
// publishedAt normalization
// ---------------------------------------------------------------------------

describe('updatePost — publishedAt normalization', () => {
  it('normalizes an offset-form publishedAt to UTC Z', async () => {
    const { graphql, calls } = makeGraphql(
      existingPublishedPost, // getPost won't be called (no status change, explicit publishedAt)
      updatedPostResult,
    )

    await updatePost(graphql, {
      postId: 'post-123',
      publishedAt: '2026-06-04T21:00:00+09:00',
    })

    const mutateCall = calls.find((c) => c.op.includes('updatePost'))
    expect(mutateCall).toBeDefined()
    // 2026-06-04T21:00:00+09:00 = 2026-06-04T12:00:00.000Z
    expect((mutateCall!.vars as { input: Record<string, unknown> }).input.publishedAt).toBe(
      '2026-06-04T12:00:00.000Z',
    )
  })

  it('normalizes a UTC Z publishedAt unchanged (idempotent)', async () => {
    const { graphql, calls } = makeGraphql(existingPublishedPost, updatedPostResult)

    await updatePost(graphql, {
      postId: 'post-123',
      publishedAt: '2026-06-04T12:00:00.000Z',
    })

    const mutateCall = calls.find((c) => c.op.includes('updatePost'))
    expect(
      (mutateCall!.vars as { input: Record<string, unknown> }).input.publishedAt,
    ).toBe('2026-06-04T12:00:00.000Z')
  })

  it('throws when publishedAt is an invalid date string', async () => {
    const { graphql } = makeGraphql(existingPublishedPost, updatedPostResult)

    await expect(
      updatePost(graphql, {
        postId: 'post-123',
        publishedAt: 'not-a-date',
      }),
    ).rejects.toThrow(/Invalid publishedAt/)
  })
})

// ---------------------------------------------------------------------------
// read-then-fill: status='published', no explicit publishedAt
// ---------------------------------------------------------------------------

describe('updatePost — read-then-fill publishedAt', () => {
  it('fills publishedAt=now when transitioning to published and existing row has none', async () => {
    const before = Date.now()

    const { graphql, calls } = makeGraphql(existingDraftPost, {
      updatePost: {
        ...existingDraftPost.getPost,
        status: 'published',
        publishedAt: new Date().toISOString(),
      },
    })

    await updatePost(graphql, {
      postId: 'post-123',
      status: 'published',
      // no publishedAt supplied
    })

    const after = Date.now()

    const mutateCall = calls.find((c) => c.op.includes('updatePost'))
    expect(mutateCall).toBeDefined()
    const filled = (mutateCall!.vars as { input: Record<string, unknown> }).input.publishedAt as string
    expect(filled).toBeDefined()
    // The filled timestamp must be parseable and within the test window.
    const filledMs = new Date(filled).getTime()
    expect(filledMs).toBeGreaterThanOrEqual(before)
    expect(filledMs).toBeLessThanOrEqual(after)
  })

  it('does NOT overwrite an existing publishedAt when transitioning to published', async () => {
    const { graphql, calls } = makeGraphql(existingPublishedPost, {
      updatePost: { ...existingPublishedPost.getPost },
    })

    await updatePost(graphql, {
      postId: 'post-123',
      status: 'published',
      // no publishedAt supplied; existing row already has one
    })

    const mutateCall = calls.find((c) => c.op.includes('updatePost'))
    // publishedAt should NOT be present in the mutation input (not overwritten).
    const input = (mutateCall!.vars as { input: Record<string, unknown> }).input
    expect(input.publishedAt).toBeUndefined()
  })

  it('does NOT fetch existing post when publishedAt is explicitly supplied', async () => {
    // When the caller supplies an explicit publishedAt, normalize it and
    // skip the getPost read — no extra round-trip needed.
    const { graphql, calls } = makeGraphql(existingDraftPost, {
      updatePost: {
        ...existingDraftPost.getPost,
        status: 'published',
        publishedAt: '2026-12-01T00:00:00.000Z',
      },
    })

    await updatePost(graphql, {
      postId: 'post-123',
      status: 'published',
      publishedAt: '2026-12-01T00:00:00.000Z',
    })

    // Only the mutation call — no getPost / listPosts call issued.
    const fetchCalls = calls.filter(
      (c) => c.op.includes('getPost') || c.op.includes('GetPost') || c.op.includes('listPosts'),
    )
    expect(fetchCalls).toHaveLength(0)

    const mutateCall = calls.find((c) => c.op.includes('updatePost'))
    expect(
      (mutateCall!.vars as { input: Record<string, unknown> }).input.publishedAt,
    ).toBe('2026-12-01T00:00:00.000Z')
  })
})

describe('updatePost — expectedVersion (atomic conditional write)', () => {
  const T0 = '2026-06-01T00:00:00.000Z'
  const stored = {
    postId: 'post-123',
    slug: 'my-post',
    title: 'My Post',
    excerpt: null,
    format: 'markdown',
    body: '"hello"',
    status: 'draft',
    publishedAt: null,
    updatedAt: T0,
    tags: ['a'],
    metadata: JSON.stringify({ cache: 'deep' }),
  }
  // The version get_post would have returned for `stored`.
  const V0 = postVersion(toCorePost(stored))

  function client(opts: { current?: unknown; mutate?: (vars: Record<string, unknown>) => unknown } = {}) {
    const calls: Call[] = []
    const graphql: GraphqlClient = {
      async query<T>(op: string, vars?: Record<string, unknown>): Promise<T> {
        calls.push({ op, vars })
        if (op.includes('getPost(')) return { getPost: opts.current === undefined ? stored : opts.current } as T
        if (op.includes('amplessUpdatePostIfUnchanged(')) {
          if (opts.mutate) return opts.mutate(vars!) as T
          return { amplessUpdatePostIfUnchanged: { ...stored, title: 'New', updatedAt: '2026-06-01T00:00:00.001Z' } } as T
        }
        throw new Error(`unexpected op ${op}`)
      },
    }
    const conditional = () => calls.filter((c) => c.op.includes('amplessUpdatePostIfUnchanged('))
    return { graphql, calls, conditional }
  }

  it('without expectedVersion sends the unchanged stock mutation with no condition', async () => {
    const updated = { updatePost: { ...existingPublishedPost.getPost, title: 'New' } }
    const { graphql, calls } = makeGraphql(existingPublishedPost, updated)
    await updatePost(graphql, { postId: 'post-123', title: 'New' })
    const call = calls.find((c) => c.op.includes('updatePost'))!
    expect(call.op).toContain('mutation UpdatePost($input: UpdatePostInput!)')
    expect(call.op).not.toContain('$condition')
    expect(call.vars).toEqual({ input: { postId: 'post-123', title: 'New' } })
  })

  it('re-reads, then calls amplessUpdatePostIfUnchanged with native patch and every field of the fresh read as expected', async () => {
    const { graphql, calls, conditional } = client()
    const body = { type: 'doc', content: [] }
    const post = await updatePost(graphql, {
      postId: 'post-123',
      title: 'New',
      format: 'tiptap',
      body,
      metadata: { cache: 'hot' },
      expectedVersion: V0,
    })
    expect(calls[0]!.op).toContain('getPost(')
    expect(conditional()).toHaveLength(1)
    const vars = conditional()[0]!.vars!
    expect(vars.postId).toBe('post-123')
    expect(JSON.parse(vars.patch as string)).toEqual({ title: 'New', format: 'tiptap', body, metadata: { cache: 'hot' } })
    expect(JSON.parse(vars.expected as string)).toEqual({
      updatedAt: T0,
      title: 'My Post',
      slug: 'my-post',
      excerpt: null,
      format: 'markdown',
      body: 'hello',
      status: 'draft',
      publishedAt: null,
      tags: ['a'],
      metadata: { cache: 'deep' },
    })
    expect(calls.some((c) => c.op.includes('updatePost('))).toBe(false)
    expect(post.title).toBe('New')
  })

  it('fills publishedAt from the fresh read when publishing a post that has none', async () => {
    const { graphql, conditional } = client()
    await updatePost(graphql, { postId: 'post-123', status: 'published', expectedVersion: V0 })
    const patch = JSON.parse(conditional()[0]!.vars!.patch as string)
    expect(patch.status).toBe('published')
    expect(typeof patch.publishedAt).toBe('string')
  })

  it('conflicts without writing when the fresh read has another version or the post is gone', async () => {
    const changed = client({ current: { ...stored, updatedAt: '2026-06-02T00:00:00.000Z' } })
    await expect(updatePost(changed.graphql, { postId: 'post-123', title: 'x', expectedVersion: V0 })).rejects.toThrow(
      /conflict.*Nothing was saved.*get_post/s,
    )
    expect(changed.conditional()).toHaveLength(0)

    const gone = client({ current: null })
    await expect(updatePost(gone.graphql, { postId: 'post-123', title: 'x', expectedVersion: V0 })).rejects.toThrow(/conflict/)
    expect(gone.conditional()).toHaveLength(0)
  })

  it('conflicts without writing when only the content changed (same updatedAt)', async () => {
    const sameMs = client({ current: { ...stored, metadata: JSON.stringify({ cache: 'deep', plugin: 1 }) } })
    await expect(updatePost(sameMs.graphql, { postId: 'post-123', title: 'x', expectedVersion: V0 })).rejects.toThrow(/conflict/)
    expect(sameMs.conditional()).toHaveLength(0)
  })

  it('returns the written post with its new version', async () => {
    const { graphql } = client()
    const post = await updatePost(graphql, { postId: 'post-123', title: 'New', expectedVersion: V0 })
    expect(post.version).toMatch(/^v1:[0-9a-f]{64}$/)
    expect(post.version).not.toBe(V0)
  })

  it('maps a ConditionalCheckFailedException to a conflict error', async () => {
    const { graphql } = client({
      mutate: () => {
        throw Object.assign(new Error('AppSync GraphQL error: The conditional request failed'), {
          errors: [{ errorType: 'DynamoDB:ConditionalCheckFailedException', message: 'The conditional request failed' }],
        })
      },
    })
    await expect(updatePost(graphql, { postId: 'post-123', title: 'x', expectedVersion: V0 })).rejects.toThrow(
      /conflict.*Nothing was saved.*get_post/s,
    )
  })

  it('a backend without the mutation fails clearly and never falls back to the stock update', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { graphql, calls } = client({
      mutate: () => {
        throw Object.assign(new Error("AppSync GraphQL error: Validation error of type FieldUndefined: Field 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined"), {
          errors: [{ errorType: 'FieldUndefined', message: "Field 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined" }],
        })
      },
    })
    await expect(updatePost(graphql, { postId: 'post-123', title: 'x', expectedVersion: V0 })).rejects.toThrow(
      /lacks the amplessUpdatePostIfUnchanged mutation.*Nothing was saved/s,
    )
    expect(calls.some((c) => c.op.includes('updatePost('))).toBe(false)
    errorSpy.mockRestore()
  })

  it('rethrows other errors unchanged', async () => {
    const original = Object.assign(new Error('AppSync GraphQL error: Not Authorized'), {
      errors: [{ errorType: 'Unauthorized', message: 'Not Authorized' }],
    })
    const { graphql } = client({
      mutate: () => {
        throw original
      },
    })
    await expect(updatePost(graphql, { postId: 'post-123', title: 'x', expectedVersion: V0 })).rejects.toBe(original)
  })

  it('rejects an empty expectedVersion, or one with nothing to change, without writing', async () => {
    const { graphql, calls } = client()
    await expect(updatePost(graphql, { postId: 'post-123', expectedVersion: '' })).rejects.toThrow(/expectedVersion/)
    await expect(updatePost(graphql, { postId: 'post-123', expectedVersion: V0 })).rejects.toThrow(/at least one field/)
    expect(calls).toHaveLength(0)
  })
})

describe('updatePost — metadata with post classes', () => {
  const updated = { updatePost: existingPublishedPost.getPost }

  it('rejects a tagged post-classes value with invalid ids without writing', async () => {
    const { graphql, calls } = makeGraphql(existingPublishedPost, updated)
    await expect(
      updatePost(graphql, {
        postId: 'post-123',
        metadata: { 'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids: ['ok', 'Not OK'] } },
      }),
    ).rejects.toThrow(/invalid post class id "Not OK"/)
    expect(calls).toHaveLength(0)
  })

  it('still replaces metadata wholesale (valid tagged value, legacy postClasses pass through)', async () => {
    const { graphql, calls } = makeGraphql(existingPublishedPost, updated)
    const metadata = {
      cache: 'deep',
      postClasses: ['Legacy Value'],
      'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids: ['wide'] },
    }
    await updatePost(graphql, { postId: 'post-123', metadata })
    const call = calls.find((c) => c.op.includes('updatePost'))!
    expect((call.vars as { input: Record<string, unknown> }).input.metadata).toBe(JSON.stringify(metadata))
  })
})
