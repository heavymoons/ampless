// Static bundle storage through the MCP tools, against an in-memory S3
// (`StorageClient`) and an in-memory AppSync stand-in that applies
// `updatePost` conditions as a real compare-and-swap on `updatedAt`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { uploadStaticBundle } from './upload-static-bundle.js'
import { uploadStaticFile } from './upload-static-file.js'
import { deleteStaticFile } from './delete-static-file.js'
import { commitStaticPost } from './commit-static-post.js'
import { deletePost } from './delete-post.js'
import type { GraphqlClient, StorageClient } from './types.js'

function makeZip(entries: Record<string, string>): string {
  const u8: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(entries)) u8[k] = strToU8(v)
  return Buffer.from(zipSync(u8)).toString('base64')
}

function makeS3() {
  const objects = new Map<string, Uint8Array>()
  const puts: string[] = []
  const deletes: string[] = []
  const storage: StorageClient = {
    async putObject(key, body) {
      puts.push(key)
      objects.set(key, new Uint8Array(body))
      return { url: `https://test/${key}` }
    },
    async deleteObject(key) {
      deletes.push(key)
      objects.delete(key)
    },
    async listObjects(prefix) {
      return [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, size: v.byteLength }))
    },
    publicUrl(key) {
      return `https://test/${key}`
    },
  }
  const text = (key: string) => {
    const v = objects.get(key)
    return v === undefined ? undefined : new TextDecoder().decode(v)
  }
  return {
    storage,
    objects,
    puts,
    deletes,
    text,
    seed(key: string, value: string) {
      objects.set(key, strToU8(value))
    },
    snapshot: () => Object.fromEntries([...objects.keys()].sort().map((k) => [k, text(k)])),
  }
}

interface RawPost {
  postId: string
  slug: string
  title: string
  format: string
  body: string
  status: string
  updatedAt?: string
  metadata?: string
}

// One-table AppSync stand-in. `updatePost` honours `condition.updatedAt`
// (`eq` / `attributeExists: false`) and fails like AppSync does.
function makeGraphql(initial: RawPost[]) {
  const rows = new Map(initial.map((r) => [r.postId, { ...r }]))
  let clock = 0
  const bump = () => new Date(Date.UTC(2026, 10, 22, 0, 0, ++clock)).toISOString()
  let beforeNextUpdate: (() => void) | null = null
  const writes: string[] = []
  const graphql: GraphqlClient = {
    async query<T>(op: string, vars?: Record<string, unknown>): Promise<T> {
      if (op.includes('listPosts')) {
        const slug = (vars!.filter as { slug: { eq: string } }).slug.eq
        return { listPosts: { items: [...rows.values()].filter((r) => r.slug === slug) } } as T
      }
      if (op.includes('createPost')) {
        writes.push('createPost')
        const input = vars!.input as RawPost
        const row = { ...input, updatedAt: bump() }
        rows.set(row.postId, row)
        return { createPost: { ...row } } as T
      }
      if (op.includes('updatePost')) {
        const hook = beforeNextUpdate
        beforeNextUpdate = null
        hook?.()
        writes.push('updatePost')
        const input = vars!.input as Partial<RawPost> & { postId: string }
        const row = rows.get(input.postId)!
        const cond = (vars!.condition as { updatedAt: { eq?: string; attributeExists?: boolean } } | undefined)?.updatedAt
        if (cond && (cond.eq !== undefined ? row.updatedAt !== cond.eq : row.updatedAt !== undefined)) {
          throw Object.assign(new Error('The conditional request failed (Service: DynamoDb)'), {
            graphqlErrors: [{ errorType: 'DynamoDB:ConditionalCheckFailedException' }],
          })
        }
        Object.assign(row, input, { updatedAt: bump() })
        return { updatePost: { ...row } } as T
      }
      if (op.includes('deletePost')) {
        const postId = (vars!.input as { postId: string }).postId
        rows.delete(postId)
        return { deletePost: { postId } } as T
      }
      if (op.includes('getPost(')) {
        const row = rows.get(vars!.postId as string)
        return { getPost: row ? { ...row } : null } as T
      }
      throw new Error(`unexpected op: ${op}`)
    },
  }
  return {
    graphql,
    writes,
    row: (postId: string) => {
      const r = rows.get(postId)
      return r ? { ...r, body: JSON.parse(r.body), metadata: r.metadata ? JSON.parse(r.metadata) : undefined } : undefined
    },
    /** A concurrent writer (e.g. the admin) changing the row. */
    concurrentWrite(postId: string, patch: Partial<RawPost>) {
      Object.assign(rows.get(postId)!, patch, { updatedAt: bump() })
    },
    onBeforeNextUpdate(fn: () => void) {
      beforeNextUpdate = fn
    },
  }
}

const VERSION_RE = /^[a-z0-9]+-[0-9a-f]{10}$/
const legacyRow = (): RawPost => ({
  postId: 'p1',
  slug: 'lp',
  title: 'LP',
  format: 'static',
  body: JSON.stringify({ entrypoint: 'index.html', files: ['index.html'], uploadedAt: 'v1' }),
  status: 'published',
  updatedAt: '2026-11-01T00:00:00.000Z',
  metadata: JSON.stringify({ files: { 'index.html': { size: 9, mimeType: 'text/html; charset=utf-8' } } }),
})
const versionedRow = (): RawPost => ({
  ...legacyRow(),
  body: JSON.stringify({ entrypoint: 'index.html', files: ['index.html'], uploadedAt: 'v1', version: 'v1' }),
})
const LEGACY_KEY = 'public/static/lp/index.html'
const VERSIONED_KEY = 'public/static/_v/lp/v1/index.html'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('upload_static_bundle: immutable versions, swapped by a conditional write', () => {
  for (const [layout, make, liveKey] of [
    ['legacy', legacyRow, LEGACY_KEY],
    ['versioned', versionedRow, VERSIONED_KEY],
  ] as const) {
    it(`${layout}: a write landing between the upload and the post write leaves the live bundle intact and removes the upload`, async () => {
      const s3 = makeS3()
      s3.seed(liveKey, '<p>v1</p>')
      const before = s3.snapshot()
      const db = makeGraphql([make()])
      db.onBeforeNextUpdate(() => {
        // The upload is done by now.
        expect(s3.puts).toHaveLength(2)
        db.concurrentWrite('p1', { title: 'Changed by admin' })
      })

      await expect(
        uploadStaticBundle(db.graphql, s3.storage, {
          slug: 'lp',
          title: 'LP by MCP',
          zipBase64: makeZip({ 'index.html': '<p>new</p>', 'about.html': '<p>about</p>' }),
        }),
      ).rejects.toThrow(/modified by someone else.*live bundle is unchanged.*retry/s)

      // The stored post is the competitor's, and its files are untouched.
      expect(db.row('p1')!.title).toBe('Changed by admin')
      expect(db.row('p1')!.body).toEqual(JSON.parse(make().body))
      expect(s3.text(liveKey)).toBe('<p>v1</p>')
      // The new version was uploaded beside it and removed again.
      expect(s3.puts.every((k) => k.startsWith('public/static/_v/lp/'))).toBe(true)
      expect(s3.snapshot()).toEqual(before)
    })
  }

  it('legacy: a successful replace writes a versioned body and leaves the legacy files in place', async () => {
    const s3 = makeS3()
    s3.seed(LEGACY_KEY, '<p>v1</p>')
    const db = makeGraphql([legacyRow()])

    const result = await uploadStaticBundle(db.graphql, s3.storage, {
      slug: 'lp',
      title: 'LP',
      zipBase64: makeZip({ 'index.html': '<p>new</p>' }),
    })

    const version = result.bundle.version!
    expect(version).toMatch(VERSION_RE)
    expect(db.row('p1')!.body).toMatchObject({ files: ['index.html'], version })
    expect(s3.snapshot()).toEqual({
      [LEGACY_KEY]: '<p>v1</p>',
      [`public/static/_v/lp/${version}/index.html`]: '<p>new</p>',
    })
    expect(s3.deletes).toEqual([])
  })

  it('versioned: a successful replace garbage-collects the previous version', async () => {
    const s3 = makeS3()
    s3.seed(VERSIONED_KEY, '<p>v1</p>')
    s3.seed('public/static/_v/lp/v1/img/a.png', 'png')
    const db = makeGraphql([versionedRow()])

    const result = await uploadStaticBundle(db.graphql, s3.storage, {
      slug: 'lp',
      title: 'LP',
      zipBase64: makeZip({ 'index.html': '<p>new</p>' }),
    })

    const version = result.bundle.version!
    expect(version).not.toBe('v1')
    expect(s3.snapshot()).toEqual({ [`public/static/_v/lp/${version}/index.html`]: '<p>new</p>' })
  })

  it('a failed garbage collection is logged and does not fail the call', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s3 = makeS3()
    s3.seed(VERSIONED_KEY, '<p>v1</p>')
    s3.storage.deleteObject = async () => {
      throw new Error('S3 down')
    }
    const db = makeGraphql([versionedRow()])

    const result = await uploadStaticBundle(db.graphql, s3.storage, {
      slug: 'lp',
      title: 'LP',
      zipBase64: makeZip({ 'index.html': '<p>new</p>' }),
    })

    expect(db.row('p1')!.body).toMatchObject({ version: result.bundle.version })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('public/static/_v/lp/v1/'), expect.any(Error))
  })
})

describe('per-file static tools', () => {
  it('fail closed on a post with a versioned bundle: nothing in S3 or the post changes', async () => {
    const s3 = makeS3()
    s3.seed(VERSIONED_KEY, '<p>v1</p>')
    s3.seed(LEGACY_KEY, '<p>old legacy</p>')
    const before = s3.snapshot()
    const db = makeGraphql([versionedRow()])
    const guidance = /versioned bundle.*upload_static_bundle/

    await expect(
      uploadStaticFile(db.graphql, s3.storage, {
        slug: 'lp',
        filename: 'index.html',
        base64Data: Buffer.from('<p>x</p>').toString('base64'),
      }),
    ).rejects.toThrow(guidance)
    await expect(
      deleteStaticFile(db.graphql, s3.storage, { slug: 'lp', filename: 'index.html' }),
    ).rejects.toThrow(guidance)
    await expect(commitStaticPost(db.graphql, s3.storage, { slug: 'lp' })).rejects.toThrow(guidance)

    expect(s3.snapshot()).toEqual(before)
    expect(db.writes).toEqual([])
    expect(db.row('p1')!.body).toEqual(JSON.parse(versionedRow().body))
  })

  it('keep working on a legacy post: edit the legacy prefix, then commit its manifest', async () => {
    const s3 = makeS3()
    s3.seed(LEGACY_KEY, '<p>v1</p>')
    s3.seed('public/static/lp/old.css', 'x')
    const db = makeGraphql([legacyRow()])

    await uploadStaticFile(db.graphql, s3.storage, {
      slug: 'lp',
      filename: 'about.html',
      base64Data: Buffer.from('<p>about</p>').toString('base64'),
    })
    await deleteStaticFile(db.graphql, s3.storage, { slug: 'lp', filename: 'old.css' })
    const result = await commitStaticPost(db.graphql, s3.storage, { slug: 'lp' })

    expect(s3.snapshot()).toEqual({ [LEGACY_KEY]: '<p>v1</p>', 'public/static/lp/about.html': '<p>about</p>' })
    expect(result.created).toBe(false)
    expect(db.row('p1')!.body).toMatchObject({ entrypoint: 'index.html', files: ['about.html', 'index.html'] })
    expect(db.row('p1')!.body.version).toBeUndefined()
  })

  it('commit_static_post does not overwrite a post changed after its read', async () => {
    const s3 = makeS3()
    s3.seed(LEGACY_KEY, '<p>v1</p>')
    const db = makeGraphql([legacyRow()])
    db.onBeforeNextUpdate(() => {
      db.concurrentWrite('p1', { body: versionedRow().body })
    })

    await expect(commitStaticPost(db.graphql, s3.storage, { slug: 'lp' })).rejects.toThrow(
      /modified by someone else.*retry/,
    )
    expect(db.row('p1')!.body).toEqual(JSON.parse(versionedRow().body))
  })

  it('refuse the reserved `_v` slug, whose legacy prefix would hold every versioned bundle', async () => {
    const s3 = makeS3()
    s3.seed(VERSIONED_KEY, '<p>v1</p>')
    const db = makeGraphql([])

    await expect(
      deleteStaticFile(db.graphql, s3.storage, { slug: '_v', filename: 'lp/v1/index.html' }),
    ).rejects.toThrow(/reserved/)
    await expect(commitStaticPost(db.graphql, s3.storage, { slug: '_v', title: 'x' })).rejects.toThrow(/reserved/)
    expect(s3.text(VERSIONED_KEY)).toBe('<p>v1</p>')
  })
})

describe('delete_post', () => {
  it("removes a static post's legacy prefix and every versioned bundle of its slug, after the row", async () => {
    const s3 = makeS3()
    s3.seed(VERSIONED_KEY, '<p>v1</p>')
    s3.seed('public/static/_v/lp/orphan-1/index.html', 'orphan')
    s3.seed(LEGACY_KEY, '<p>legacy</p>')
    s3.seed('public/static/_v/lp-2/v1/index.html', 'other')
    s3.seed('public/static/lp-2/index.html', 'other')
    const db = makeGraphql([versionedRow()])

    await deletePost(db.graphql, { postId: 'p1' }, () => s3.storage)

    expect(db.row('p1')).toBeUndefined()
    expect(s3.snapshot()).toEqual({
      'public/static/_v/lp-2/v1/index.html': 'other',
      'public/static/lp-2/index.html': 'other',
    })
  })

  it('leaves S3 alone for a non-static post', async () => {
    const s3 = makeS3()
    s3.seed(LEGACY_KEY, '<p>legacy</p>')
    const db = makeGraphql([{ ...legacyRow(), format: 'markdown', body: JSON.stringify('hi') }])

    await deletePost(db.graphql, { postId: 'p1' }, () => s3.storage)

    expect(db.row('p1')).toBeUndefined()
    expect(s3.deletes).toEqual([])
  })
})
