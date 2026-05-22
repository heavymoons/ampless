import { describe, it, expect } from 'vitest'
import { commitStaticPost } from './commit-static-post.js'
import type { GraphqlClient, StorageClient, StorageObject } from './types.js'

function makeStorage(initial: StorageObject[]): StorageClient {
  return {
    async putObject(key) {
      return key
    },
    async deleteObject() {},
    async listObjects(prefix) {
      return initial.filter((o) => o.key.startsWith(prefix))
    },
  }
}

function makeGraphql(getResult: unknown, mutateResult: unknown): {
  graphql: GraphqlClient
  calls: { op: string; vars: Record<string, unknown> | undefined }[]
} {
  const calls: { op: string; vars: Record<string, unknown> | undefined }[] = []
  return {
    graphql: {
      async query(op: string, vars?: Record<string, unknown>) {
        calls.push({ op, vars })
        if (op.includes('listPosts')) return getResult
        if (op.includes('createPost')) return mutateResult
        if (op.includes('updatePost')) return mutateResult
        return {}
      },
    } as GraphqlClient,
    calls,
  }
}

describe('commit_static_post', () => {
  it('rebuilds the manifest from the current S3 prefix and creates a new post', async () => {
    const storage = makeStorage([
      { key: 'public/static/default/lp/index.html', size: 100 },
      { key: 'public/static/default/lp/style.css', size: 20 },
      { key: 'public/static/default/lp/img/photo.png', size: 5000 },
    ])
    const { graphql, calls } = makeGraphql(
      { listPosts: { items: [] } },
      {
        createPost: {
          siteId: 'default',
          postId: 'post-1',
          slug: 'lp',
          title: 'LP',
          format: 'static',
          body: '{}',
          status: 'draft',
        },
      },
    )

    const result = await commitStaticPost(graphql, storage, 'default', {
      slug: 'lp',
      title: 'LP',
    })

    expect(result.created).toBe(true)
    expect(result.bundle.entrypoint).toBe('index.html')
    expect(result.bundle.files).toEqual(['img/photo.png', 'index.html', 'style.css'])
    expect(calls.some((c) => c.op.includes('createPost'))).toBe(true)
  })

  it('throws when the prefix is empty', async () => {
    const storage = makeStorage([])
    const { graphql } = makeGraphql({ listPosts: { items: [] } }, {})

    await expect(
      commitStaticPost(graphql, storage, 'default', { slug: 'lp', title: 'x' }),
    ).rejects.toThrow(/no files/i)
  })

  it('refuses to create a brand-new post without a title', async () => {
    const storage = makeStorage([
      { key: 'public/static/default/lp/index.html', size: 100 },
    ])
    const { graphql } = makeGraphql({ listPosts: { items: [] } }, {})

    await expect(
      commitStaticPost(graphql, storage, 'default', { slug: 'lp' }),
    ).rejects.toThrow(/title/i)
  })

  it('updates an existing post and preserves its title when none is passed', async () => {
    const storage = makeStorage([
      { key: 'public/static/default/lp/index.html', size: 100 },
    ])
    const { graphql, calls } = makeGraphql(
      {
        listPosts: {
          items: [
            {
              siteId: 'default',
              postId: 'post-existing',
              slug: 'lp',
              title: 'Existing',
              format: 'static',
              body: '{}',
              status: 'draft',
            },
          ],
        },
      },
      {
        updatePost: {
          siteId: 'default',
          postId: 'post-existing',
          slug: 'lp',
          title: 'Existing',
          format: 'static',
          body: '{}',
          status: 'draft',
        },
      },
    )

    const result = await commitStaticPost(graphql, storage, 'default', {
      slug: 'lp',
    })

    expect(result.created).toBe(false)
    expect(result.post.title).toBe('Existing')
    expect(calls.some((c) => c.op.includes('updatePost'))).toBe(true)
  })

  it('rejects an entrypoint that is not in the prefix', async () => {
    const storage = makeStorage([
      { key: 'public/static/default/lp/index.html', size: 100 },
    ])
    const { graphql } = makeGraphql({ listPosts: { items: [] } }, {})

    await expect(
      commitStaticPost(graphql, storage, 'default', {
        slug: 'lp',
        title: 'x',
        entrypoint: 'no-such-file.html',
      }),
    ).rejects.toThrow(/entrypoint/i)
  })
})
