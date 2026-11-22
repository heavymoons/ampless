import { beforeEach, describe, expect, it, vi } from 'vitest'

const postListMock = vi.hoisted(() => vi.fn())
const postGetMock = vi.hoisted(() => vi.fn())
const postUpdateMock = vi.hoisted(() => vi.fn())
const graphqlMock = vi.hoisted(() => vi.fn())

vi.mock('aws-amplify/api', () => {
  function generateClient() {
    return {
      graphql: graphqlMock,
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

describe('admin posts provider update', () => {
  const savedRow = {
    postId: 'post-1',
    slug: 'draft-one',
    title: 'New title',
    format: 'markdown',
    body: JSON.stringify('# hi'),
    status: 'draft',
    tags: ['a'],
    metadata: JSON.stringify({ postClasses: ['b'] }),
    updatedAt: '2026-06-02T00:00:00.000Z',
  }
  const CONDITIONAL_FAILED = {
    data: { updatePost: null },
    errors: [
      {
        errorType: 'DynamoDB:ConditionalCheckFailedException',
        message: 'The conditional request failed (Service: DynamoDb, Status Code: 400)',
      },
    ],
  }

  it('declares supportsConditionalUpdate, so core forwards expectedUpdatedAt', async () => {
    const { supportsConditionalPostUpdate } = await installProvider()
    expect(supportsConditionalPostUpdate()).toBe(true)
  })

  it('without options writes through client.models.Post.update, as before', async () => {
    postUpdateMock.mockResolvedValueOnce({ data: savedRow, errors: null })
    const { updatePost } = await installProvider()

    const post = await updatePost('post-1', { title: 'New title' })

    expect(postUpdateMock).toHaveBeenCalledWith({ postId: 'post-1', title: 'New title' })
    expect(graphqlMock).not.toHaveBeenCalled()
    expect(post.title).toBe('New title')
  })

  it('with expectedUpdatedAt sends a conditional updatePost mutation and maps the row', async () => {
    graphqlMock.mockResolvedValueOnce({ data: { updatePost: savedRow } })
    const { updatePost } = await installProvider()

    const post = await updatePost(
      'post-1',
      { title: 'New title', metadata: { postClasses: ['b'] } },
      { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' }
    )

    expect(postUpdateMock).not.toHaveBeenCalled()
    const args = graphqlMock.mock.calls[0]![0] as { query: string; variables: Record<string, unknown> }
    expect(args.query).toContain('updatePost(input: $input, condition: $condition)')
    for (const field of ['postId', 'slug', 'title', 'excerpt', 'format', 'body', 'status', 'publishedAt', 'tags', 'metadata', 'updatedAt']) {
      expect(args.query).toMatch(new RegExp(`\\b${field}\\b`))
    }
    expect(args.variables).toEqual({
      input: { postId: 'post-1', title: 'New title', metadata: JSON.stringify({ postClasses: ['b'] }) },
      condition: { updatedAt: { eq: '2026-06-01T00:00:00.000Z' } },
    })
    expect(post).toMatchObject({
      postId: 'post-1',
      title: 'New title',
      body: '# hi',
      metadata: { postClasses: ['b'] },
      updatedAt: '2026-06-02T00:00:00.000Z',
    })
  })

  it('with expectedUpdatedAt null requires the row to have no updatedAt', async () => {
    graphqlMock.mockResolvedValueOnce({ data: { updatePost: savedRow } })
    const { updatePost } = await installProvider()

    await updatePost('post-1', { title: 'New title' }, { expectedUpdatedAt: null })

    const args = graphqlMock.mock.calls[0]![0] as { variables: Record<string, unknown> }
    expect(args.variables.condition).toEqual({ updatedAt: { attributeExists: false } })
  })

  it('maps a rejected ConditionalCheckFailedException to PostUpdateConflictError', async () => {
    graphqlMock.mockRejectedValueOnce(CONDITIONAL_FAILED)
    const { updatePost, PostUpdateConflictError } = await installProvider()

    await expect(
      updatePost('post-1', { title: 'x' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })
    ).rejects.toBeInstanceOf(PostUpdateConflictError)
  })

  it('maps a returned conditional failure (and a message-only one) to PostUpdateConflictError', async () => {
    graphqlMock
      .mockResolvedValueOnce(CONDITIONAL_FAILED)
      .mockRejectedValueOnce({ errors: [{ message: 'The conditional request failed' }] })
    const { updatePost, PostUpdateConflictError } = await installProvider()

    for (let i = 0; i < 2; i++) {
      await expect(
        updatePost('post-1', { title: 'x' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })
      ).rejects.toBeInstanceOf(PostUpdateConflictError)
    }
  })

  it('other GraphQL errors keep their message and are not a conflict', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock
      .mockRejectedValueOnce({ data: null, errors: [{ errorType: 'Unauthorized', message: 'Not Authorized to access updatePost' }] })
      .mockResolvedValueOnce({ data: { updatePost: null }, errors: [{ message: 'Validation error' }] })
      .mockRejectedValueOnce(new Error('Network error'))
    const { updatePost, PostUpdateConflictError } = await installProvider()
    const call = () => updatePost('post-1', { title: 'x' }, { expectedUpdatedAt: '2026-06-01T00:00:00.000Z' })

    const first = await call().catch((e: unknown) => e)
    expect(first).not.toBeInstanceOf(PostUpdateConflictError)
    expect((first as Error).message).toBe('Not Authorized to access updatePost')
    await expect(call()).rejects.toThrow('Validation error')
    await expect(call()).rejects.toThrow('Network error')
    expect(errorSpy).toHaveBeenCalled()
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
