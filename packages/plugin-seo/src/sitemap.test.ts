import { describe, it, expect } from 'vitest'
import type { Post, Config } from 'ampless'
import { buildSitemap } from './sitemap.js'

const site: Config['site'] = { name: 'Test', url: 'https://example.com/' }

const published: Post = {
  siteId: 'default',
  postId: 'p1',
  slug: 'hello & world',
  title: 'Hello',
  format: 'tiptap',
  body: {},
  status: 'published',
  publishedAt: '2026-04-01T00:00:00.000Z',
}

const draft: Post = { ...published, postId: 'p2', slug: 'draft', status: 'draft' }

describe('buildSitemap', () => {
  it('emits a valid urlset with home + published posts only', () => {
    const xml = buildSitemap([published, draft], site)
    expect(xml).toContain('<urlset')
    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect((xml.match(/<url>/g) ?? []).length).toBe(2)
    expect(xml).not.toContain('/draft')
  })

  it('escapes ampersand in slug', () => {
    const xml = buildSitemap([published], site)
    expect(xml).toContain('hello &amp; world')
  })

  it('emits <lastmod> only when publishedAt is present', () => {
    const xml = buildSitemap([published, { ...published, publishedAt: undefined }], site)
    expect((xml.match(/<lastmod>/g) ?? []).length).toBe(1)
    expect(xml).toContain('<lastmod>2026-04-01T00:00:00.000Z</lastmod>')
  })

  it('respects changefreq and priority overrides', () => {
    const xml = buildSitemap([published], site, { changefreq: 'monthly', priority: 0.3 })
    expect(xml).toContain('<changefreq>monthly</changefreq>')
    expect(xml).toContain('<priority>0.3</priority>')
  })

  it('honors limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...published,
      postId: `p-${i}`,
      slug: `s-${i}`,
    }))
    const xml = buildSitemap(many, site, { limit: 4 })
    // 4 posts + 1 home = 5 url entries
    expect((xml.match(/<url>/g) ?? []).length).toBe(5)
  })
})
