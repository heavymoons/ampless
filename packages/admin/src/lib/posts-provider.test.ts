import { beforeEach, describe, expect, it, vi } from 'vitest'

const postListMock = vi.hoisted(() => vi.fn())

vi.mock('aws-amplify/api', () => {
  function generateClient() {
    return {
      models: {
        Post: {
          list: postListMock,
          async get() {
            return { data: null, errors: null }
          },
          async create() {
            return { data: null, errors: null }
          },
          async update() {
            return { data: null, errors: null }
          },
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
