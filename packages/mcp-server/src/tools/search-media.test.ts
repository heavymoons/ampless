import { describe, it, expect } from 'vitest'
import { searchMedia } from './search-media.js'
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

interface Page {
  items: Array<{ mediaId: string; src: string }>
  nextToken: string | null
}

/**
 * GraphQL mock that serves a sequence of pages. `next` is the page
 * returned when the incoming `nextToken` runs past the supplied list —
 * used to simulate an unbounded scan (always-more) for the page-cap test.
 */
function makeGraphql(pages: Page[], onOverflow?: () => Page): {
  graphql: GraphqlClient
  calls: Array<Record<string, unknown>>
} {
  const calls: Array<Record<string, unknown>> = []
  let i = 0
  return {
    graphql: {
      async query<T>(_op: string, variables?: Record<string, unknown>): Promise<T> {
        calls.push(variables ?? {})
        const page = pages[i] ?? onOverflow?.() ?? { items: [], nextToken: null }
        i += 1
        const fill = (p: Page) => ({
          listMedia: {
            items: p.items.map((it) => ({
              mediaId: it.mediaId,
              src: it.src,
              mimeType: 'image/png',
              size: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            })),
            nextToken: p.nextToken,
          },
        })
        return fill(page) as unknown as T
      },
    },
    calls,
  }
}

describe('search_media', () => {
  it('builds an or(contains) filter across src and mimeType', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    await searchMedia(g.graphql, makeStorage(), { query: 'logo' })
    expect(g.calls[0]?.filter).toEqual({
      or: [{ src: { contains: 'logo' } }, { mimeType: { contains: 'logo' } }],
    })
  })

  it('throws when query is missing', async () => {
    const g = makeGraphql([])
    await expect(
      // @ts-expect-error intentionally omitting required query
      searchMedia(g.graphql, makeStorage(), {}),
    ).rejects.toThrow(/query/)
  })

  it('walks pages internally until it has collected `limit` matches', async () => {
    // limit 3: page0 → 1 match, page1 → 0 matches, page2 → 2 matches (stop).
    const g = makeGraphql([
      { items: [{ mediaId: 'm1', src: 'public/media/a.png' }], nextToken: 't1' },
      { items: [], nextToken: 't2' },
      {
        items: [
          { mediaId: 'm2', src: 'public/media/b.png' },
          { mediaId: 'm3', src: 'public/media/c.png' },
        ],
        nextToken: null,
      },
    ])

    const result = await searchMedia(g.graphql, makeStorage(), { query: '.png', limit: 3 })

    expect(result.media.map((m) => m.mediaId)).toEqual(['m1', 'm2', 'm3'])
    expect(result.nextToken).toBeNull()
    expect(result).not.toHaveProperty('truncated')
    expect(g.calls).toHaveLength(3)
    // The derived url is present on each result.
    expect(result.media[0]?.url).toBe('https://test.s3.amazonaws.com/public/media/a.png')
  })

  it('stops at the page cap and reports truncated when matches stay sparse', async () => {
    // Every page returns no matches but always a token → unbounded scan.
    const g = makeGraphql([], () => ({ items: [], nextToken: 'more' }))

    const result = await searchMedia(g.graphql, makeStorage(), { query: 'zzz', limit: 5 })

    expect(result.media).toHaveLength(0)
    expect(result.truncated).toBe(true)
    expect(result.nextToken).toBe('more')
    expect(g.calls).toHaveLength(20) // MAX_PAGES
  })

  it('forwards an inbound nextToken on the first page request', async () => {
    const g = makeGraphql([{ items: [], nextToken: null }])
    await searchMedia(g.graphql, makeStorage(), { query: 'x', nextToken: 'start-here' })
    expect(g.calls[0]?.nextToken).toBe('start-here')
  })
})
