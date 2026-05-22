import { describe, it, expect, vi, beforeEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { uploadStaticBundle } from './upload-static-bundle.js'
import type { GraphqlClient, StorageClient, StorageObject } from './types.js'

function makeZip(entries: Record<string, string | Uint8Array>): Buffer {
  const u8: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(entries)) {
    u8[k] = typeof v === 'string' ? strToU8(v) : v
  }
  return Buffer.from(zipSync(u8))
}

function makeStorage(initial: StorageObject[] = []): {
  storage: StorageClient
  puts: { key: string; body: Uint8Array; contentType: string }[]
  deletes: string[]
} {
  const puts: { key: string; body: Uint8Array; contentType: string }[] = []
  const deletes: string[] = []
  let listed = [...initial]
  return {
    storage: {
      async putObject(key, body, contentType) {
        puts.push({ key, body, contentType })
        return `https://test.s3.us-east-1.amazonaws.com/${key}`
      },
      async deleteObject(key) {
        deletes.push(key)
        listed = listed.filter((o) => o.key !== key)
      },
      async listObjects(prefix) {
        return listed.filter((o) => o.key.startsWith(prefix))
      },
    },
    puts,
    deletes,
  }
}

function makeGraphql(getResult: unknown, mutateResult: unknown): {
  graphql: GraphqlClient
  calls: { op: string; vars: Record<string, unknown> | undefined }[]
} {
  const calls: { op: string; vars: Record<string, unknown> | undefined }[] = []
  let listPostsResponse = getResult
  return {
    graphql: {
      async query(op: string, vars?: Record<string, unknown>) {
        calls.push({ op, vars })
        if (op.includes('listPosts')) {
          return listPostsResponse
        }
        // After create/update we typically want to follow up with
        // PostTag mutations — they go via the same client. Return a
        // success-shaped object so syncPostTags doesn't blow up.
        if (op.includes('createPost')) {
          listPostsResponse = { listPosts: { items: [(mutateResult as { createPost: unknown }).createPost] } }
          return mutateResult
        }
        if (op.includes('updatePost')) {
          return mutateResult
        }
        if (op.includes('PostTag')) {
          return {}
        }
        return {}
      },
    } as GraphqlClient,
    calls,
  }
}

describe('upload_static_bundle', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('extracts a zip, wipes the prefix, uploads files, and creates a new post', async () => {
    const zip = makeZip({
      'index.html': '<html><body><img src="img/x.png"></body></html>',
      'img/x.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'style.css': '.x { color: red; }',
    })

    const { storage, puts, deletes } = makeStorage([
      { key: 'public/static/default/my-lp/old.html', size: 10 },
    ])

    const { graphql, calls } = makeGraphql(
      { listPosts: { items: [] } },
      {
        createPost: {
          siteId: 'default',
          postId: 'post-1',
          slug: 'my-lp',
          title: 'My LP',
          format: 'static',
          body: '{"entrypoint":"index.html","files":["img/x.png","index.html","style.css"],"uploadedAt":"2026-05-20T00:00:00.000Z"}',
          status: 'draft',
        },
      },
    )

    const result = await uploadStaticBundle(graphql, storage, 'default', {
      slug: 'my-lp',
      title: 'My LP',
      zipBase64: zip.toString('base64'),
    })

    // Existing prefix object is wiped first.
    expect(deletes).toEqual(['public/static/default/my-lp/old.html'])

    // All three files uploaded.
    const keys = puts.map((p) => p.key).sort()
    expect(keys).toEqual([
      'public/static/default/my-lp/img/x.png',
      'public/static/default/my-lp/index.html',
      'public/static/default/my-lp/style.css',
    ])

    // index.html got the right content-type.
    const indexPut = puts.find((p) => p.key.endsWith('/index.html'))!
    expect(indexPut.contentType).toBe('text/html; charset=utf-8')

    // Post created (one createPost call).
    expect(calls.some((c) => c.op.includes('createPost'))).toBe(true)
    expect(result.uploadedFiles).toBe(3)
    expect(result.bundle.entrypoint).toBe('index.html')
    expect(result.bundle.files).toEqual(['img/x.png', 'index.html', 'style.css'])
    expect(result.post.format).toBe('static')
  })

  it('rejects bundles with absolute path refs inside HTML', async () => {
    const zip = makeZip({
      'index.html': '<img src="/absolute/path.png">',
    })
    const { storage } = makeStorage()
    const { graphql } = makeGraphql({ listPosts: { items: [] } }, {})

    await expect(
      uploadStaticBundle(graphql, storage, 'default', {
        slug: 'bad',
        title: 'x',
        zipBase64: zip.toString('base64'),
      }),
    ).rejects.toThrow(/absolute/i)
  })

  it('rejects bundles whose entrypoint is missing', async () => {
    const zip = makeZip({ 'about.html': '<!doctype html>' })
    const { storage } = makeStorage()
    const { graphql } = makeGraphql({ listPosts: { items: [] } }, {})

    await expect(
      uploadStaticBundle(graphql, storage, 'default', {
        slug: 'no-entry',
        title: 'x',
        zipBase64: zip.toString('base64'),
        entrypoint: 'index.html',
      }),
    ).rejects.toThrow(/entrypoint/i)
  })

  it('updates an existing post when the slug already has a Post row', async () => {
    const zip = makeZip({ 'index.html': '<!doctype html>' })
    const { storage } = makeStorage()
    const { graphql, calls } = makeGraphql(
      {
        listPosts: {
          items: [
            {
              siteId: 'default',
              postId: 'post-existing',
              slug: 'my-lp',
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
          slug: 'my-lp',
          title: 'My LP',
          format: 'static',
          body: '{}',
          status: 'draft',
        },
      },
    )

    const result = await uploadStaticBundle(graphql, storage, 'default', {
      slug: 'my-lp',
      title: 'My LP',
      zipBase64: zip.toString('base64'),
    })

    expect(calls.some((c) => c.op.includes('updatePost'))).toBe(true)
    expect(calls.some((c) => c.op.includes('createPost'))).toBe(false)
    expect(result.post.postId).toBe('post-existing')
  })

  it('rejects an empty zip body', async () => {
    const { storage } = makeStorage()
    const { graphql } = makeGraphql({ listPosts: { items: [] } }, {})

    await expect(
      uploadStaticBundle(graphql, storage, 'default', {
        slug: 'empty',
        title: 'x',
        zipBase64: '',
      }),
    ).rejects.toThrow(/zero bytes/i)
  })
})
