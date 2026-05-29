import { describe, it, expect } from 'vitest'
import { deleteMedia } from './delete-media.js'
import type { GraphqlClient, StorageClient, StorageObject } from './types.js'

interface MediaRow {
  mediaId: string
  src: string
}

function makeGraphql(rows: MediaRow[]): {
  graphql: GraphqlClient
  calls: Array<{ op: string; vars: Record<string, unknown> }>
  rows: MediaRow[]
} {
  const state = { rows: [...rows] }
  const calls: Array<{ op: string; vars: Record<string, unknown> }> = []
  return {
    graphql: {
      async query<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
        calls.push({ op: operation, vars: variables ?? {} })
        if (operation.includes('query GetMedia(')) {
          const mediaId = String(variables?.mediaId ?? '')
          const found = state.rows.find((r) => r.mediaId === mediaId) ?? null
          return { getMedia: found } as unknown as T
        }
        if (operation.includes('query GetMediaBySrc(')) {
          const src = String(variables?.src ?? '')
          const found = state.rows.find((r) => r.src === src) ?? null
          return { getMediaBySrc: found } as unknown as T
        }
        if (operation.includes('mutation DeleteMedia(')) {
          const input = variables?.input as { mediaId?: string } | undefined
          const mediaId = input?.mediaId ?? ''
          state.rows = state.rows.filter((r) => r.mediaId !== mediaId)
          return { deleteMedia: { mediaId } } as unknown as T
        }
        throw new Error(`unexpected operation: ${operation.slice(0, 40)}`)
      },
    },
    calls,
    rows: state.rows,
  }
}

function makeStorage(initial: StorageObject[] = []): {
  storage: StorageClient
  deletes: string[]
} {
  const deletes: string[] = []
  let items = [...initial]
  return {
    storage: {
      async putObject(key) {
        return { url: key }
      },
      async deleteObject(key) {
        deletes.push(key)
        items = items.filter((o) => o.key !== key)
      },
      async listObjects(prefix) {
        return items.filter((o) => o.key.startsWith(prefix))
      },
    },
    deletes,
  }
}

const ROW = {
  mediaId: 'media-1714400000000-abc123',
  src: 'public/media/2026/05/1714400000000-photo.jpg',
}

describe('delete_media', () => {
  it('throws when neither mediaId nor src is given', async () => {
    const g = makeGraphql([ROW])
    const s = makeStorage()
    await expect(deleteMedia(g.graphql, s.storage, {})).rejects.toThrow(/mediaId/)
  })

  it('deletes by mediaId: looks up row, S3 delete, then DDB delete', async () => {
    const g = makeGraphql([ROW])
    const s = makeStorage([{ key: ROW.src, size: 1000 }])

    const result = await deleteMedia(g.graphql, s.storage, { mediaId: ROW.mediaId })

    expect(result).toEqual({ deleted: true, mediaId: ROW.mediaId, src: ROW.src })
    expect(s.deletes).toEqual([ROW.src])
    expect(g.calls.map((c) => c.op.match(/(query|mutation) \w+/)?.[0])).toEqual([
      'query GetMedia',
      'mutation DeleteMedia',
    ])
  })

  it('deletes by src: looks up via getMediaBySrc, S3 delete, then DDB delete', async () => {
    const g = makeGraphql([ROW])
    const s = makeStorage([{ key: ROW.src, size: 1000 }])

    const result = await deleteMedia(g.graphql, s.storage, { src: ROW.src })

    expect(result).toEqual({ deleted: true, mediaId: ROW.mediaId, src: ROW.src })
    expect(s.deletes).toEqual([ROW.src])
    expect(g.calls[0]?.op).toMatch(/GetMediaBySrc/)
  })

  it('with mediaId not found and no src: returns deleted:false, no S3 call', async () => {
    const g = makeGraphql([]) // no rows
    const s = makeStorage()

    const result = await deleteMedia(g.graphql, s.storage, { mediaId: 'missing' })

    expect(result.deleted).toBe(false)
    expect(s.deletes).toHaveLength(0)
  })

  it('with src not found in row table: still issues S3 delete (orphan cleanup)', async () => {
    const g = makeGraphql([]) // no rows
    const s = makeStorage([{ key: 'public/media/2026/05/orphan.jpg', size: 1 }])

    const result = await deleteMedia(g.graphql, s.storage, {
      src: 'public/media/2026/05/orphan.jpg',
    })

    expect(result.deleted).toBe(false)
    if (result.deleted === false) {
      expect(result.src).toBe('public/media/2026/05/orphan.jpg')
    }
    expect(s.deletes).toEqual(['public/media/2026/05/orphan.jpg'])
    // No DeleteMedia mutation — no row to delete
    expect(g.calls.find((c) => c.op.includes('mutation'))).toBeUndefined()
  })

  it('S3 deleteObject is called with the row src (not user-supplied src) when mediaId resolves', async () => {
    // Caller passes ONLY mediaId; src is sourced from the row, never trusted from caller.
    const g = makeGraphql([ROW])
    const s = makeStorage([{ key: ROW.src, size: 1 }])

    await deleteMedia(g.graphql, s.storage, { mediaId: ROW.mediaId })

    expect(s.deletes[0]).toBe(ROW.src)
  })
})
