import { describe, it, expect, vi } from 'vitest'

// Mock `ampless` so this test runs without a built package.
vi.mock('ampless', () => ({
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
