import { describe, it, expect } from 'vitest'
import { collectBounded, type BoundedScanPage } from './paging.js'

interface Call {
  limit: number
  nextToken?: string
}

// Turns a fixed sequence of pages into a fetcher, served in call order
// regardless of the `nextToken` the caller passes back in (faithful to
// how a real cursor API is driven — the caller always threads through
// whatever the previous page returned).
function sequential<T>(pages: BoundedScanPage<T>[]): {
  fetchPage: (args: { limit: number; nextToken?: string }) => Promise<BoundedScanPage<T>>
  calls: Call[]
} {
  const calls: Call[] = []
  let i = 0
  return {
    fetchPage: async (args) => {
      calls.push({ limit: args.limit, nextToken: args.nextToken })
      const page = pages[i] ?? { items: [], nextToken: null }
      i += 1
      return page
    },
    calls,
  }
}

describe('collectBounded', () => {
  it('requests Math.min(pageSizeCap, limit+1-collected) per page and concatenates items', async () => {
    const { fetchPage, calls } = sequential<number>([
      { items: [1, 2], nextToken: 'A' },
      { items: [3], nextToken: null },
    ])
    const res = await collectBounded(fetchPage, { limit: 3, pageSizeCap: 50, maxPages: 21 })
    expect(res.items).toEqual([1, 2, 3])
    expect(res.truncated).toBeNull()
    expect(calls[0]).toEqual({ limit: 4, nextToken: undefined }) // min(50, 3+1-0)
    expect(calls[1]).toEqual({ limit: 2, nextToken: 'A' }) // min(50, 3+1-2)
  })

  it("limit+1 reached: drops the extra item and reports truncated='limit'", async () => {
    const { fetchPage } = sequential<number>([{ items: [1, 2, 3], nextToken: null }])
    const res = await collectBounded(fetchPage, { limit: 2 })
    expect(res.items).toEqual([1, 2])
    expect(res.truncated).toBe('limit')
  })

  it('exactly `limit` items with token exhausted: no truncation', async () => {
    const { fetchPage } = sequential<number>([{ items: [1, 2], nextToken: null }])
    const res = await collectBounded(fetchPage, { limit: 2 })
    expect(res.items).toEqual([1, 2])
    expect(res.truncated).toBeNull()
  })

  it('token present but the limit+1th page turns out empty: no truncation', async () => {
    const { fetchPage, calls } = sequential<number>([
      { items: [1, 2], nextToken: 'B' },
      { items: [], nextToken: null },
    ])
    const res = await collectBounded(fetchPage, { limit: 2 })
    expect(res.items).toEqual([1, 2])
    expect(res.truncated).toBeNull()
    expect(calls.length).toBe(2)
  })

  it('caps the per-page request at pageSizeCap even when limit is large', async () => {
    const { fetchPage, calls } = sequential<number>([{ items: [], nextToken: null }])
    await collectBounded(fetchPage, { limit: 1000, pageSizeCap: 50 })
    expect(calls[0]!.limit).toBe(50)
  })

  it("maxPages cutoff: stops after maxPages pages and reports truncated='early'", async () => {
    const pages: BoundedScanPage<number>[] = Array.from({ length: 30 }, (_, i) => ({
      items: [i],
      nextToken: `page-${i}`,
    }))
    const { fetchPage, calls } = sequential(pages)
    const res = await collectBounded(fetchPage, { limit: 1000, pageSizeCap: 50, maxPages: 5 })
    expect(calls.length).toBe(5)
    expect(res.truncated).toBe('early')
  })

  it("duplicate nextToken: stops instead of looping forever and reports truncated='early'", async () => {
    let calls = 0
    const fetchPage = async (): Promise<BoundedScanPage<number>> => {
      calls += 1
      return { items: [calls], nextToken: 'DUPE' }
    }
    const res = await collectBounded(fetchPage, { limit: 1000, maxPages: 21 })
    expect(calls).toBe(2)
    expect(res.truncated).toBe('early')
  })

  describe('argument contract: finite positive integers only', () => {
    const noopFetch = async (): Promise<BoundedScanPage<number>> => ({ items: [], nextToken: null })

    for (const bad of [NaN, Infinity, -Infinity, 0, -1, 1.5]) {
      it(`rejects limit=${String(bad)} with TypeError`, async () => {
        await expect(collectBounded(noopFetch, { limit: bad })).rejects.toThrow(TypeError)
      })
      it(`rejects pageSizeCap=${String(bad)} with TypeError`, async () => {
        await expect(
          collectBounded(noopFetch, { limit: 10, pageSizeCap: bad }),
        ).rejects.toThrow(TypeError)
      })
      it(`rejects maxPages=${String(bad)} with TypeError`, async () => {
        await expect(
          collectBounded(noopFetch, { limit: 10, maxPages: bad }),
        ).rejects.toThrow(TypeError)
      })
    }
  })
})
