import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import { listTagsTool } from './list-tags.js'
import type { PublicToolContext } from './types.js'

let seq = 0
function makePost(tags: string[]): Post {
  seq += 1
  return {
    postId: `p${seq}`,
    slug: `post-${seq}`,
    title: `Post ${seq}`,
    format: 'markdown',
    body: {},
    status: 'published',
    tags,
  }
}

type ListFn = (opts: { limit?: number; nextToken?: string }) => Promise<{
  items: Post[]
  nextToken: string | null
}>

function ctxFromList(list: ListFn): PublicToolContext {
  return {
    listPublishedPosts: list,
    getPublishedPost: async () => null,
    postToMarkdown: async () => '',
  }
}

function ctxFromPages(pages: { items: Post[]; nextToken: string | null }[]): PublicToolContext {
  let i = 0
  return ctxFromList(async () => {
    const page = pages[i] ?? { items: [], nextToken: null }
    i += 1
    return page
  })
}

describe('public list_tags', () => {
  it('aggregates tag counts and sorts by descending count (ties alphabetical)', async () => {
    const ctx = ctxFromPages([
      {
        items: [
          makePost(['ts', 'aws']),
          makePost(['ts', 'react']),
          makePost(['ts', 'aws']),
          makePost(['react']),
        ],
        nextToken: null,
      },
    ])
    const res = (await listTagsTool.handler({}, ctx)) as {
      tags: { tag: string; count: number }[]
      scanTruncated: boolean
    }
    expect(res.tags).toEqual([
      { tag: 'ts', count: 3 },
      { tag: 'aws', count: 2 },
      { tag: 'react', count: 2 },
    ])
    expect(res.scanTruncated).toBe(false)
  })

  it('returns an empty tag list for a site with no tags', async () => {
    const ctx = ctxFromPages([{ items: [makePost([])], nextToken: null }])
    const res = (await listTagsTool.handler({}, ctx)) as {
      tags: unknown[]
      scanTruncated: boolean
    }
    expect(res.tags).toEqual([])
    expect(res.scanTruncated).toBe(false)
  })

  it('bounds the scan at maxPages = 5 and reports scanTruncated', async () => {
    let calls = 0
    const ctx = ctxFromList(async () => {
      calls += 1
      return { items: [makePost(['loop'])], nextToken: `tok-${calls}` }
    })
    const res = (await listTagsTool.handler({}, ctx)) as { scanTruncated: boolean }
    expect(calls).toBe(5)
    expect(res.scanTruncated).toBe(true)
  })
})
