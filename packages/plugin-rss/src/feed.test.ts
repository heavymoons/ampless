import { describe, it, expect } from 'vitest'
import type { Post, Config } from 'ampless'
import rssPlugin from './index.js'
import { buildRssFeed } from './feed.js'

const site: Config['site'] = {
  name: 'Test Site',
  url: 'https://example.com/',
  description: 'A test',
}

const posts: Post[] = [
  {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello & welcome',
    excerpt: "It's nice",
    format: 'tiptap',
    body: { type: 'doc', content: [] },
    status: 'published',
    publishedAt: '2026-04-01T00:00:00.000Z',
    tags: ['intro', 'meta'],
  },
  {
    postId: 'p2',
    slug: 'draft',
    title: 'Draft',
    format: 'tiptap',
    body: {},
    status: 'draft',
  },
]

describe('buildRssFeed', () => {
  it('declares trusted plugin capabilities', () => {
    expect(rssPlugin().capabilities).toEqual([
      'eventHooks',
      'writePublicAsset',
      'metadata',
    ])
  })

  it('emits valid RSS 2.0 with channel + only published items', () => {
    const xml = buildRssFeed(posts, site)
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<title>Test Site</title>')
    expect(xml).toContain('<link>https://example.com</link>')
    expect(xml).toContain('<title>Hello &amp; welcome</title>')
    expect(xml).not.toContain('<title>Draft</title>')
  })

  it('strips trailing slash from siteUrl', () => {
    const xml = buildRssFeed(posts, site)
    expect(xml).toContain('<link>https://example.com/hello</link>')
    expect(xml).not.toContain('https://example.com//hello')
  })

  it('escapes apostrophes as &#39; (not &apos;)', () => {
    const xml = buildRssFeed(posts, site)
    expect(xml).toContain('&#39;')
    expect(xml).not.toContain('&apos;')
  })

  it('includes <language> with default "en" and respects override', () => {
    expect(buildRssFeed(posts, site)).toContain('<language>en</language>')
    expect(buildRssFeed(posts, site, { language: 'ja' })).toContain(
      '<language>ja</language>'
    )
  })

  it('honors limit option', () => {
    const many: Post[] = Array.from({ length: 10 }, (_, i) => ({
      ...posts[0]!,
      postId: `p-${i}`,
      slug: `s-${i}`,
      title: `T${i}`,
    }))
    const xml = buildRssFeed(many, site, { limit: 3 })
    const itemCount = (xml.match(/<item>/g) ?? []).length
    expect(itemCount).toBe(3)
  })

  it('emits one <category> per tag', () => {
    const xml = buildRssFeed(posts, site)
    expect((xml.match(/<category>/g) ?? []).length).toBe(2)
    expect(xml).toContain('<category>intro</category>')
  })

  it('uses the override siteUrl when supplied', () => {
    const xml = buildRssFeed(posts, site, { siteUrl: 'https://staging.example.com' })
    expect(xml).toContain('<link>https://staging.example.com/hello</link>')
  })

  it('handles empty post list without crashing', () => {
    const xml = buildRssFeed([], site)
    expect(xml).toContain('<rss')
    expect(xml).not.toContain('<item>')
  })
})
