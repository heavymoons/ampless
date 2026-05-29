import { describe, it, expect } from 'vitest'
import { listMedia, buildMediaFilter } from './list-media.js'
import type { GraphqlClient, StorageClient } from './types.js'

function makeStorage(): StorageClient {
  return {
    async putObject(key) {
      return { url: key }
    },
    async deleteObject() {},
    async listObjects() {
      return []
    },
    publicUrl(key) {
      return `https://test.s3.amazonaws.com/${key}`
    },
  }
}

function makeGraphql(items: unknown[], nextToken: string | null = null): {
  graphql: GraphqlClient
  calls: Array<{ op: string; vars: Record<string, unknown> }>
} {
  const calls: Array<{ op: string; vars: Record<string, unknown> }> = []
  return {
    graphql: {
      async query<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
        calls.push({ op: operation, vars: variables ?? {} })
        return { listMedia: { items, nextToken } } as unknown as T
      },
    },
    calls,
  }
}

const ROW = {
  mediaId: 'media-1',
  src: 'public/media/2024/01/old.png',
  mimeType: 'image/png',
  size: 1234,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
}

describe('buildMediaFilter', () => {
  it('returns undefined when no filters are given', () => {
    expect(buildMediaFilter({})).toBeUndefined()
  })

  it('uses beginsWith for mimeType (prefix match)', () => {
    expect(buildMediaFilter({ mimeType: 'image/' })).toEqual({
      mimeType: { beginsWith: 'image/' },
    })
  })

  it('uses beginsWith on src for prefix', () => {
    expect(buildMediaFilter({ prefix: 'public/media/2024/' })).toEqual({
      src: { beginsWith: 'public/media/2024/' },
    })
  })

  it('uses between when both date bounds are given', () => {
    expect(
      buildMediaFilter({ createdAfter: '2024-01-01', createdBefore: '2024-12-31' }),
    ).toEqual({ createdAt: { between: ['2024-01-01', '2024-12-31'] } })
  })

  it('uses ge / le for a single date bound', () => {
    expect(buildMediaFilter({ createdAfter: '2024-01-01' })).toEqual({
      createdAt: { ge: '2024-01-01' },
    })
    expect(buildMediaFilter({ createdBefore: '2024-12-31' })).toEqual({
      createdAt: { le: '2024-12-31' },
    })
  })

  it('wraps multiple conditions in an `and`', () => {
    const filter = buildMediaFilter({ mimeType: 'image/png', prefix: 'public/media/2024/' })
    expect(filter).toEqual({
      and: [
        { mimeType: { beginsWith: 'image/png' } },
        { src: { beginsWith: 'public/media/2024/' } },
      ],
    })
  })
})

describe('list_media', () => {
  it('maps rows to results with a derived url and passes through nextToken', async () => {
    const g = makeGraphql([ROW], 'cursor-1')
    const result = await listMedia(g.graphql, makeStorage(), { limit: 10 })

    expect(result.nextToken).toBe('cursor-1')
    expect(result.media).toEqual([
      {
        mediaId: ROW.mediaId,
        src: ROW.src,
        url: `https://test.s3.amazonaws.com/${ROW.src}`,
        mimeType: ROW.mimeType,
        size: ROW.size,
        createdAt: ROW.createdAt,
        updatedAt: ROW.updatedAt,
      },
    ])
    expect(g.calls[0]?.vars.limit).toBe(10)
  })

  it('defaults limit to 20 and sends no filter when none requested', async () => {
    const g = makeGraphql([])
    await listMedia(g.graphql, makeStorage(), {})
    expect(g.calls[0]?.vars.limit).toBe(20)
    expect(g.calls[0]?.vars.filter).toBeUndefined()
  })

  it('forwards the built filter to the query', async () => {
    const g = makeGraphql([])
    await listMedia(g.graphql, makeStorage(), { mimeType: 'image/png' })
    expect(g.calls[0]?.vars.filter).toEqual({ mimeType: { beginsWith: 'image/png' } })
  })
})
