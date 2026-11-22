import { describe, it, expect, vi } from 'vitest'

// Mock `ampless` so this test runs without a built package. The post
// class id helpers are tiny pure functions; inline equivalents keep the
// mock self-contained.
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

// ---------------------------------------------------------------------------
// postClasses (theme post-level classes)
// ---------------------------------------------------------------------------

const existingWithMetadata = {
  getPost: {
    ...existingPublishedPost.getPost,
    metadata: JSON.stringify({ cache: 'deep', no_layout: true, seo: { title: 'X' }, postClasses: ['old'] }),
  },
}
const mutationInput = (calls: Call[]) =>
  (calls.find((c) => c.op.includes('updatePost'))!.vars as { input: Record<string, unknown> }).input
const writtenMetadata = (calls: Call[]) => JSON.parse(mutationInput(calls).metadata as string)
const fetches = (calls: Call[]) => calls.filter((c) => c.op.includes('getPost') || c.op.includes('GetPost'))

describe('updatePost — postClasses', () => {
  it('without metadata: merges into the current metadata, keeping cache / no_layout / plugin keys', async () => {
    const { graphql, calls } = makeGraphql(existingWithMetadata, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', postClasses: ['wide', 'serif', 'wide'] })
    expect(fetches(calls)).toHaveLength(1)
    expect(writtenMetadata(calls)).toEqual({
      cache: 'deep',
      no_layout: true,
      seo: { title: 'X' },
      postClasses: ['wide', 'serif'],
    })
  })

  it('without metadata: an empty array removes the key and keeps the rest', async () => {
    const { graphql, calls } = makeGraphql(existingWithMetadata, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', postClasses: [] })
    expect(writtenMetadata(calls)).toEqual({ cache: 'deep', no_layout: true, seo: { title: 'X' } })
  })

  it('without metadata: works on a post that has no metadata yet', async () => {
    const { graphql, calls } = makeGraphql(existingDraftPost, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })
    expect(writtenMetadata(calls)).toEqual({ postClasses: ['wide'] })
  })

  it('without metadata: replaces a stored invalid postClasses value instead of rejecting', async () => {
    const corrupt = { getPost: { ...existingDraftPost.getPost, metadata: JSON.stringify({ cache: 'deep', postClasses: 'Bad' }) } }
    const { graphql, calls } = makeGraphql(corrupt, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })
    expect(writtenMetadata(calls)).toEqual({ cache: 'deep', postClasses: ['wide'] })
  })

  it('throws when the post does not exist (nothing written)', async () => {
    const { graphql, calls } = makeGraphql({ getPost: null }, updatedPostResult)
    await expect(updatePost(graphql, { postId: 'missing', postClasses: ['wide'] })).rejects.toThrow(
      /Post not found: missing/,
    )
    expect(calls.find((c) => c.op.includes('updatePost'))).toBeUndefined()
  })

  it('with metadata: puts postClasses into the supplied object without reading the post', async () => {
    const { graphql, calls } = makeGraphql(existingWithMetadata, updatedPostResult)
    await updatePost(graphql, {
      postId: 'post-123',
      metadata: { cache: 'hot', postClasses: ['ignored'] },
      postClasses: ['wide'],
    })
    expect(fetches(calls)).toHaveLength(0)
    expect(writtenMetadata(calls)).toEqual({ cache: 'hot', postClasses: ['wide'] })
  })

  it('reads the post once when both the merge and the publishedAt fill need it', async () => {
    const { graphql, calls } = makeGraphql(existingDraftPost, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', status: 'published', postClasses: ['wide'] })
    expect(fetches(calls)).toHaveLength(1)
    expect(mutationInput(calls).publishedAt).toBeDefined()
    expect(writtenMetadata(calls)).toEqual({ postClasses: ['wide'] })
  })

  it('rejects invalid ids with an error naming them, before any read or write', async () => {
    const { graphql, calls } = makeGraphql(existingWithMetadata, updatedPostResult)
    await expect(
      updatePost(graphql, { postId: 'post-123', postClasses: ['wide', 'Bad Id', 'x" onmouseover='] }),
    ).rejects.toThrow(/Invalid postClasses id\(s\): "Bad Id", "x\\" onmouseover="/)
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-array postClasses', async () => {
    const { graphql } = makeGraphql(existingWithMetadata, updatedPostResult)
    await expect(
      updatePost(graphql, { postId: 'post-123', postClasses: 'wide' as unknown as string[] }),
    ).rejects.toThrow(/postClasses must be an array/)
  })

  it('validates metadata.postClasses when supplied', async () => {
    const { graphql, calls } = makeGraphql(existingWithMetadata, updatedPostResult)
    await expect(
      updatePost(graphql, { postId: 'post-123', metadata: { postClasses: ['UPPER'] } }),
    ).rejects.toThrow(/Invalid metadata.postClasses id\(s\): "UPPER"/)
    expect(calls).toHaveLength(0)

    await updatePost(graphql, { postId: 'post-123', metadata: { cache: 'deep', postClasses: ['wide'] } })
    expect(writtenMetadata(calls)).toEqual({ cache: 'deep', postClasses: ['wide'] })
  })
})

// ---------------------------------------------------------------------------
// postClasses merge: compare-and-swap on updatedAt
// ---------------------------------------------------------------------------

const mutationVars = (calls: Call[]) => calls.find((c) => c.op.includes('updatePost'))!.vars as Record<string, unknown>

/**
 * A fake AppSync backed by one stored row. `onRead` runs after each read is
 * answered, so a test can simulate an editor saving between update_post's
 * read and its write. The update enforces `condition.updatedAt` the way
 * DynamoDB does and rejects like the real client does (message plus the
 * attached `graphqlErrors`).
 */
function makeStore(row: Record<string, unknown>, onRead?: (row: Record<string, unknown>) => void) {
  const writes: Record<string, unknown>[] = []
  const graphql: GraphqlClient = {
    async query(op: string, vars?: Record<string, unknown>) {
      if (op.includes('getPost')) {
        const snapshot = { ...row }
        onRead?.(row)
        return { getPost: snapshot } as never
      }
      if (op.includes('updatePost')) {
        const input = vars!.input as Record<string, unknown>
        const cond = (vars!.condition as { updatedAt?: { eq?: string; attributeExists?: boolean } } | undefined)
          ?.updatedAt
        const ok =
          !cond ||
          (cond.eq !== undefined && row.updatedAt === cond.eq) ||
          (cond.attributeExists === false && row.updatedAt == null)
        if (!ok) {
          const errors = [
            {
              message: 'The conditional request failed (Service: DynamoDb, Status Code: 400)',
              errorType: 'DynamoDB:ConditionalCheckFailedException',
            },
          ]
          throw Object.assign(new Error(`AppSync GraphQL error: ${errors[0].message}`), { graphqlErrors: errors })
        }
        writes.push(input)
        Object.assign(row, input, { updatedAt: '2026-06-05T00:00:00.000Z' })
        return { updatePost: { ...row } } as never
      }
      return {} as never
    },
  }
  return { graphql, writes }
}

describe('updatePost — postClasses merge is atomic', () => {
  const withUpdatedAt = {
    getPost: { ...existingWithMetadata.getPost, updatedAt: '2026-06-01T00:00:00.000Z' },
  }

  it('sends a condition on the updatedAt it read', async () => {
    const { graphql, calls } = makeGraphql(withUpdatedAt, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })
    expect(mutationVars(calls).condition).toEqual({ updatedAt: { eq: '2026-06-01T00:00:00.000Z' } })
  })

  it('requires updatedAt to be absent when the read row has none', async () => {
    const { graphql, calls } = makeGraphql(existingWithMetadata, updatedPostResult)
    await updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })
    expect(mutationVars(calls).condition).toEqual({ updatedAt: { attributeExists: false } })
  })

  it('sends no condition on the other paths', async () => {
    const cases = [
      { postId: 'post-123', title: 'T' },
      { postId: 'post-123', status: 'published' as const },
      { postId: 'post-123', metadata: { cache: 'hot' as const } },
      { postId: 'post-123', metadata: { cache: 'hot' as const }, postClasses: ['wide'] },
    ]
    for (const args of cases) {
      const { graphql, calls } = makeGraphql(withUpdatedAt, updatedPostResult)
      await updatePost(graphql, args)
      expect(Object.keys(mutationVars(calls))).toEqual(['input'])
    }
  })

  it('fails without writing when an editor saves between the read and the write', async () => {
    const row: Record<string, unknown> = {
      ...existingPublishedPost.getPost,
      updatedAt: '2026-06-01T00:00:00.000Z',
      metadata: JSON.stringify({ cache: 'deep' }),
    }
    const editorMetadata = JSON.stringify({ cache: 'hot', seo: { title: 'Editor' } })
    const { graphql, writes } = makeStore(row, (r) => {
      r.metadata = editorMetadata
      r.updatedAt = '2026-06-01T00:00:05.000Z'
    })

    await expect(updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })).rejects.toThrow(
      'Post post-123 was modified by someone else while update_post was merging postClasses into its metadata; nothing was written. Re-read the post and retry.',
    )
    expect(writes).toHaveLength(0)
    expect(row.metadata).toBe(editorMetadata)
    expect(row.updatedAt).toBe('2026-06-01T00:00:05.000Z')
  })

  it('writes when nothing changed in between', async () => {
    const row: Record<string, unknown> = {
      ...existingPublishedPost.getPost,
      updatedAt: '2026-06-01T00:00:00.000Z',
      metadata: JSON.stringify({ cache: 'deep' }),
    }
    const { graphql, writes } = makeStore(row)
    await updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })
    expect(writes).toHaveLength(1)
    expect(JSON.parse(row.metadata as string)).toEqual({ cache: 'deep', postClasses: ['wide'] })
  })

  it('detects the conflict from the message alone (client without graphqlErrors)', async () => {
    const graphql: GraphqlClient = {
      async query(op: string) {
        if (op.includes('getPost')) return withUpdatedAt as never
        throw new Error('AppSync GraphQL error: The conditional request failed (Service: DynamoDb, Status Code: 400)')
      },
    }
    await expect(updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })).rejects.toThrow(
      /was modified by someone else/,
    )
  })

  it('re-throws other errors unchanged', async () => {
    const boom = new Error('AppSync GraphQL error: Not Authorized to access updatePost on type Mutation')
    const graphql: GraphqlClient = {
      async query(op: string) {
        if (op.includes('getPost')) return withUpdatedAt as never
        throw boom
      },
    }
    await expect(updatePost(graphql, { postId: 'post-123', postClasses: ['wide'] })).rejects.toBe(boom)
  })

  it('does not translate a conditional failure on a non-merge path', async () => {
    const err = Object.assign(new Error('AppSync GraphQL error: The conditional request failed'), {
      graphqlErrors: [{ message: 'The conditional request failed', errorType: 'DynamoDB:ConditionalCheckFailedException' }],
    })
    const graphql: GraphqlClient = {
      async query() {
        throw err
      },
    }
    await expect(updatePost(graphql, { postId: 'post-123', title: 'T' })).rejects.toBe(err)
  })
})
