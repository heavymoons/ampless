import { describe, it, expect } from 'vitest'
import type { Post, Config } from 'ampless'
import { buildPostMetadata, buildSiteMetadata } from './metadata.js'

const site: Config['site'] = {
  name: 'Test Site',
  url: 'https://example.com/',
  description: 'Site desc',
}

const post: Post = {
  postId: 'p1',
  slug: 'hello',
  title: 'Hello',
  excerpt: 'A teaser',
  format: 'tiptap',
  body: {},
  status: 'published',
}

describe('buildPostMetadata', () => {
  it('produces title, canonical, og:article, twitter card', () => {
    const m = buildPostMetadata(post, site)
    expect(m.title).toBe('Hello')
    expect(m.description).toBe('A teaser')
    expect(m.alternates?.canonical).toBe('https://example.com/hello')
    expect(m.openGraph?.type).toBe('article')
    expect(m.openGraph?.url).toBe('https://example.com/hello')
    expect(m.twitter?.card).toBe('summary_large_image')
  })

  it('falls back to site description when post excerpt is missing', () => {
    const m = buildPostMetadata({ ...post, excerpt: undefined }, site)
    expect(m.description).toBe('Site desc')
  })

  it('omits images when no defaultOgImage is set', () => {
    const m = buildPostMetadata(post, site)
    expect(m.openGraph?.images).toBeUndefined()
    expect(m.twitter?.images).toBeUndefined()
  })

  it('applies defaultOgImage to both openGraph and twitter when set', () => {
    const m = buildPostMetadata(post, site, { defaultOgImage: 'https://example.com/og.png' })
    expect(m.openGraph?.images?.[0]?.url).toBe('https://example.com/og.png')
    expect(m.twitter?.images?.[0]).toBe('https://example.com/og.png')
  })

  it('threads twitter handles', () => {
    const m = buildPostMetadata(post, site, {
      twitterSite: '@site',
      twitterCreator: '@author',
    })
    expect(m.twitter?.site).toBe('@site')
    expect(m.twitter?.creator).toBe('@author')
  })
})

describe('buildSiteMetadata', () => {
  it('returns site-level og:website with summary card', () => {
    const m = buildSiteMetadata(site)
    expect(m.title).toBe('Test Site')
    expect(m.description).toBe('Site desc')
    expect(m.openGraph?.type).toBe('website')
    expect(m.openGraph?.url).toBe('https://example.com/')
    expect(m.twitter?.card).toBe('summary')
  })

  it('falls back to site name when description is missing', () => {
    const m = buildSiteMetadata({ ...site, description: undefined })
    expect(m.description).toBe('Test Site')
  })
})
