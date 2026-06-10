import { describe, expect, it } from 'vitest'
import type { PostSummary } from './core.js'
import { collectTags, filterSortPostSummaries } from './post-list-filter.js'

const rows: PostSummary[] = [
  {
    postId: 'post-1',
    slug: 'hello-world',
    title: 'Hello World',
    status: 'published',
    publishedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    tags: ['news', 'Welcome'],
  },
  {
    postId: 'post-2',
    slug: 'draft-note',
    title: '下書きメモ',
    status: 'draft',
    updatedAt: '2026-01-03T00:00:00.000Z',
    tags: ['ja', 'notes'],
  },
  {
    postId: 'post-3',
    slug: 'alpha',
    title: 'Alpha',
    status: 'published',
    publishedAt: '2026-01-02T00:00:00.000Z',
    tags: ['news'],
  },
]

describe('filterSortPostSummaries', () => {
  it('matches query against title, slug, and tags case-insensitively', () => {
    expect(ids(filterSortPostSummaries(rows, { query: 'HELLO' }))).toEqual(['post-1'])
    expect(ids(filterSortPostSummaries(rows, { query: 'draft' }))).toEqual(['post-2'])
    expect(ids(filterSortPostSummaries(rows, { query: 'welcome' }))).toEqual(['post-1'])
    expect(ids(filterSortPostSummaries(rows, { query: 'メモ' }))).toEqual(['post-2'])
  })

  it('filters by status', () => {
    expect(ids(filterSortPostSummaries(rows, { status: 'all' }))).toEqual([
      'post-1',
      'post-2',
      'post-3',
    ])
    expect(ids(filterSortPostSummaries(rows, { status: 'published' }))).toEqual([
      'post-1',
      'post-3',
    ])
    expect(ids(filterSortPostSummaries(rows, { status: 'draft' }))).toEqual(['post-2'])
  })

  it('filters by exact tag and collects tag counts in sorted order', () => {
    expect(ids(filterSortPostSummaries(rows, { tag: 'news' }))).toEqual(['post-1', 'post-3'])
    expect(ids(filterSortPostSummaries(rows, { tag: 'News' }))).toEqual([])
    expect([...collectTags(rows).entries()]).toEqual([
      ['ja', 1],
      ['news', 2],
      ['notes', 1],
      ['Welcome', 1],
    ])
  })

  it('sorts by updatedAt with missing values last in either direction', () => {
    expect(ids(filterSortPostSummaries(rows, { sort: 'updated-desc' }))).toEqual([
      'post-1',
      'post-2',
      'post-3',
    ])
    expect(ids(filterSortPostSummaries(rows, { sort: 'updated-asc' }))).toEqual([
      'post-2',
      'post-1',
      'post-3',
    ])
  })

  it('sorts by publishedAt with missing values last in either direction', () => {
    expect(ids(filterSortPostSummaries(rows, { sort: 'published-desc' }))).toEqual([
      'post-3',
      'post-1',
      'post-2',
    ])
    expect(ids(filterSortPostSummaries(rows, { sort: 'published-asc' }))).toEqual([
      'post-1',
      'post-3',
      'post-2',
    ])
  })

  it('sorts by title', () => {
    expect(ids(filterSortPostSummaries(rows, { sort: 'title-asc' }))).toEqual([
      'post-3',
      'post-1',
      'post-2',
    ])
    expect(ids(filterSortPostSummaries(rows, { sort: 'title-desc' }))).toEqual([
      'post-2',
      'post-1',
      'post-3',
    ])
  })

  it('combines query, status, tag, and sort', () => {
    expect(
      ids(
        filterSortPostSummaries(rows, {
          query: 'a',
          status: 'published',
          tag: 'news',
          sort: 'title-asc',
        })
      )
    ).toEqual(['post-3'])
  })
})

function ids(list: PostSummary[]): string[] {
  return list.map((p) => p.postId)
}
