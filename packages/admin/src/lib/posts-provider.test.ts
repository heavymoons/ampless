import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from 'ampless'

const postListMock = vi.hoisted(() => vi.fn())
const postGetMock = vi.hoisted(() => vi.fn())
const postUpdateMock = vi.hoisted(() => vi.fn())
const graphqlMock = vi.hoisted(() => vi.fn())

vi.mock('aws-amplify/api', () => {
  function generateClient() {
    return {
      models: {
        Post: {
          list: postListMock,
          get: postGetMock,
          async create() {
            return { data: null, errors: null }
          },
          update: postUpdateMock,
          async delete() {
            return { data: null, errors: null }
          },
        },
        PostHistory: {
          async listByPost() {
            return { data: [], errors: null, nextToken: null }
          },
        },
      },
      graphql: graphqlMock,
    }
  }
  return { generateClient }
})

const SUMMARY_SELECTION_SET = [
  'postId',
  'slug',
  'title',
  'excerpt',
  'status',
  'publishedAt',
  'updatedAt',
  'tags',
]

const row1 = {
  postId: 'post-1',
  slug: 'draft-one',
  title: 'Draft one',
  excerpt: 'one',
  status: 'draft',
  publishedAt: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  tags: ['draft', null],
  body: '# body should not be requested',
  metadata: { cache: 'auto' },
}

const row2 = {
  postId: 'post-2',
  slug: 'draft-two',
  title: 'Draft two',
  status: 'draft',
  publishedAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
  tags: ['draft', 'two'],
  body: '# body should not be requested',
  metadata: { cache: 'deep' },
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  postListMock.mockReset()
  postGetMock.mockReset()
  postGetMock.mockResolvedValue({ data: null, errors: null })
  postUpdateMock.mockReset()
  postUpdateMock.mockResolvedValue({ data: null, errors: null })
  graphqlMock.mockReset()
})

describe('admin posts provider listSummaries', () => {
  it('pages through every nextToken and maps lightweight summaries', async () => {
    postListMock
      .mockResolvedValueOnce({ data: [row1], errors: null, nextToken: 'next-page' })
      .mockResolvedValueOnce({ data: [row2], errors: null, nextToken: null })

    const { listPostSummaries } = await installProvider()
    const summaries = await listPostSummaries({ status: 'draft' })

    expect(postListMock).toHaveBeenCalledTimes(2)
    expect(postListMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filter: { status: { eq: 'draft' } },
        limit: 200,
        nextToken: undefined,
      })
    )
    expect(postListMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filter: { status: { eq: 'draft' } },
        limit: 200,
        nextToken: 'next-page',
      })
    )
    expect(summaries).toEqual([
      {
        postId: 'post-1',
        slug: 'draft-one',
        title: 'Draft one',
        excerpt: 'one',
        status: 'draft',
        publishedAt: undefined,
        updatedAt: '2026-06-01T00:00:00.000Z',
        tags: ['draft'],
      },
      {
        postId: 'post-2',
        slug: 'draft-two',
        title: 'Draft two',
        excerpt: undefined,
        status: 'draft',
        publishedAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
        tags: ['draft', 'two'],
      },
    ])
    expectSummaryProjection()
  })

  it('throws on AppSync errors instead of returning a partial page set', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    postListMock
      .mockResolvedValueOnce({ data: [row1], errors: null, nextToken: 'next-page' })
      .mockResolvedValueOnce({
        data: [row2],
        errors: [{ message: 'Post.list failed on page 2' }],
        nextToken: null,
      })

    const { listPostSummaries } = await installProvider()

    await expect(listPostSummaries()).rejects.toThrow('Post.list failed on page 2')
    expect(postListMock).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalled()
    expectSummaryProjection()
  })
})

describe('admin posts provider read paths surface AppSync errors', () => {
  it('list() throws instead of silently dropping the AppSync errors array', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    postListMock.mockResolvedValueOnce({
      data: [],
      errors: [{ message: 'Post.list denied' }],
    })

    const { listPosts } = await installProvider()

    await expect(listPosts()).rejects.toThrow('Post.list denied')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('get(slug) throws instead of returning null on AppSync errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    postListMock.mockResolvedValueOnce({
      data: [],
      errors: [{ message: 'Post.get by slug denied' }],
    })

    const { getPost } = await installProvider()

    await expect(getPost('some-slug')).rejects.toThrow('Post.get by slug denied')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('getById() throws instead of returning null on AppSync errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    postGetMock.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Post.get denied' }],
    })

    const { getPostById } = await installProvider()

    await expect(getPostById('post-1')).rejects.toThrow('Post.get denied')
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('admin posts provider conditional update', () => {
  const T0 = '2026-06-01T00:00:00.000Z'
  const loaded: Post = {
    postId: 'post-1',
    slug: 'draft-one',
    title: 'Old title',
    format: 'markdown',
    body: '# old',
    status: 'draft',
    tags: [],
    metadata: { cache: 'deep' },
    updatedAt: T0,
  }
  const updatedRow = {
    postId: 'post-1',
    slug: 'draft-one',
    title: 'New title',
    format: 'markdown',
    body: '"# hi"',
    status: 'draft',
    tags: ['a'],
    metadata: JSON.stringify({ cache: 'deep', 'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids: ['wide'] } }),
    updatedAt: '2026-06-01T00:00:00.001Z',
  }
  const conditionFailed = {
    data: { amplessUpdatePostIfUnchanged: null },
    errors: [
      {
        errorType: 'DynamoDB:ConditionalCheckFailedException',
        message: 'The conditional request failed (Service: DynamoDb, Status Code: 400)',
      },
    ],
  }
  const fieldUndefined = {
    data: null,
    errors: [
      {
        errorType: 'FieldUndefined',
        message:
          "Validation error of type FieldUndefined: Field 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined @ 'amplessUpdatePostIfUnchanged'",
      },
    ],
  }

  it('is reported as supported', async () => {
    const { supportsConditionalPostUpdate } = await installProvider()
    expect(supportsConditionalPostUpdate()).toBe(true)
  })

  it('calls amplessUpdatePostIfUnchanged with JSON-string patch (set fields, native values) and expected (all fields + updatedAt)', async () => {
    graphqlMock.mockResolvedValueOnce({ data: { amplessUpdatePostIfUnchanged: updatedRow } })
    const { updatePost } = await installProvider()

    const metadata = { cache: 'deep' as const, postClasses: ['legacy'] }
    const post = await updatePost(
      'post-1',
      { title: 'New title', body: '# hi', metadata, tags: ['a'], excerpt: undefined },
      { expected: loaded }
    )

    expect(graphqlMock).toHaveBeenCalledTimes(1)
    const args = graphqlMock.mock.calls[0]![0] as { query: string; variables: Record<string, string> }
    expect(args.query).toContain('amplessUpdatePostIfUnchanged(postId: $postId, patch: $patch, expected: $expected)')
    expect(args.query).not.toContain('condition')
    for (const field of ['postId', 'slug', 'title', 'excerpt', 'format', 'body', 'status', 'publishedAt', 'tags', 'metadata', 'updatedAt']) {
      expect(args.query).toMatch(new RegExp(`\\b${field}\\b`))
    }
    expect(args.variables.postId).toBe('post-1')
    expect(JSON.parse(args.variables.patch!)).toEqual({ title: 'New title', body: '# hi', metadata, tags: ['a'] })
    expect(JSON.parse(args.variables.expected!)).toEqual({
      updatedAt: T0,
      title: 'Old title',
      slug: 'draft-one',
      excerpt: null,
      format: 'markdown',
      body: '# old',
      status: 'draft',
      publishedAt: null,
      tags: [],
      metadata: { cache: 'deep' },
    })
    expect(postUpdateMock).not.toHaveBeenCalled()
    expect(post.updatedAt).toBe('2026-06-01T00:00:00.001Z')
    expect(post.metadata).toEqual({
      cache: 'deep',
      'ampless:postClasses': { kind: 'ampless.post-classes', version: 1, ids: ['wide'] },
    })
  })

  it('maps a thrown or returned ConditionalCheckFailedException to PostUpdateConflictError', async () => {
    graphqlMock.mockRejectedValueOnce(conditionFailed).mockResolvedValueOnce(conditionFailed)
    const { updatePost, PostUpdateConflictError } = await installProvider()

    const err = await updatePost('post-1', { title: 'x' }, { expected: loaded }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PostUpdateConflictError)
    expect(err).toMatchObject({ postId: 'post-1', expectedUpdatedAt: T0 })
    await expect(updatePost('post-1', { title: 'x' }, { expected: loaded })).rejects.toBeInstanceOf(
      PostUpdateConflictError
    )
  })

  it('recognises the exception name in the message when errorType is missing', async () => {
    graphqlMock.mockRejectedValueOnce({
      errors: [{ message: 'DynamoDB:ConditionalCheckFailedException: The conditional request failed' }],
    })
    const { updatePost, PostUpdateConflictError } = await installProvider()

    await expect(updatePost('post-1', { title: 'x' }, { expected: loaded })).rejects.toBeInstanceOf(PostUpdateConflictError)
  })

  it('a backend without the mutation → ConditionalPostUpdateUnsupportedError, remembered so later saves skip the call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockRejectedValueOnce(fieldUndefined)
    const { updatePost, ConditionalPostUpdateUnsupportedError } = await installProvider()

    const e1 = await updatePost('post-1', { title: 'x' }, { expected: loaded }).catch((e: unknown) => e)
    expect(e1).toBeInstanceOf(ConditionalPostUpdateUnsupportedError)
    expect((e1 as Error).message).toMatch(/create-ampless upgrade/)
    const e2 = await updatePost('post-1', { title: 'x' }, { expected: loaded }).catch((e: unknown) => e)
    expect(e2).toBeInstanceOf(ConditionalPostUpdateUnsupportedError)
    expect(graphqlMock).toHaveBeenCalledTimes(1)
    expect(postUpdateMock).not.toHaveBeenCalled()
  })

  it('refuses (ConditionalPostUpdateUnsupportedError, no call) when expected has no updatedAt', async () => {
    const { updatePost, ConditionalPostUpdateUnsupportedError } = await installProvider()
    await expect(
      updatePost('post-1', { title: 'x' }, { expected: { ...loaded, updatedAt: undefined } })
    ).rejects.toBeInstanceOf(ConditionalPostUpdateUnsupportedError)
    expect(graphqlMock).not.toHaveBeenCalled()
    expect(postUpdateMock).not.toHaveBeenCalled()
  })

  it('logs and rethrows other GraphQL errors (thrown and returned) as plain errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock
      .mockRejectedValueOnce({ data: null, errors: [{ errorType: 'Unauthorized', message: 'Not Authorized' }] })
      .mockResolvedValueOnce({
        data: { amplessUpdatePostIfUnchanged: null },
        errors: [{ errorType: 'AmplessValidationError', message: 'patch.format must be one of tiptap, markdown, html, static' }],
      })
      // A validation error that does not name the mutation is not "unsupported".
      .mockRejectedValueOnce({ errors: [{ errorType: 'FieldUndefined', message: "Field 'nope' in type 'Post' is undefined" }] })
    const { updatePost, PostUpdateConflictError, ConditionalPostUpdateUnsupportedError } = await installProvider()

    for (const message of ['Not Authorized', 'patch.format must be one of tiptap, markdown, html, static', "Field 'nope' in type 'Post' is undefined"]) {
      const e = await updatePost('post-1', { title: 'x' }, { expected: loaded }).catch((err: unknown) => err)
      expect(e).not.toBeInstanceOf(PostUpdateConflictError)
      expect(e).not.toBeInstanceOf(ConditionalPostUpdateUnsupportedError)
      expect((e as Error).message).toBe(message)
    }
    expect(errorSpy).toHaveBeenCalledTimes(3)
  })

  it('rethrows a network-level Error as-is (logged)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const netErr = new Error('Network error')
    graphqlMock.mockRejectedValueOnce(netErr)
    const { updatePost } = await installProvider()

    await expect(updatePost('post-1', { title: 'x' }, { expected: loaded })).rejects.toBe(netErr)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('leaves the unconditional update path on client.models.Post.update', async () => {
    postUpdateMock.mockResolvedValueOnce({ data: updatedRow, errors: null })
    const { updatePost } = await installProvider()

    await updatePost('post-1', { title: 'New title' })
    expect(postUpdateMock).toHaveBeenCalledWith({ postId: 'post-1', title: 'New title' })
    expect(graphqlMock).not.toHaveBeenCalled()
  })
})

async function installProvider() {
  const { installAdminPostsProvider } = await import('./posts-provider.js')
  const core = await import('ampless')
  installAdminPostsProvider()
  return core
}

function expectSummaryProjection() {
  for (const call of postListMock.mock.calls) {
    const args = call[0] as { selectionSet?: readonly string[] }
    expect(args.selectionSet).toEqual(SUMMARY_SELECTION_SET)
    expect(args.selectionSet).not.toContain('body')
    expect(args.selectionSet).not.toContain('metadata')
  }
}
