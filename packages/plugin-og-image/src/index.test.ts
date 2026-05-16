import { describe, it, expect } from 'vitest'
import type { ReactElement } from 'react'
import type { Config, OgImageRenderContext, Post } from 'ampless'
import ogImagePlugin from './index.js'

const fakeFont = {
  name: 'Inter',
  data: new ArrayBuffer(8),
}

const site: Config['site'] = {
  name: 'Test Site',
  url: 'https://example.com/',
  description: 'desc',
}

const post: Post = {
  postId: 'p1',
  siteId: 'default',
  slug: 'hello',
  title: 'Hello',
  excerpt: 'A teaser',
  format: 'markdown',
  body: 'no image here',
  status: 'published',
}

describe('ogImagePlugin', () => {
  it('throws when no fonts are provided', () => {
    expect(() => ogImagePlugin({ fonts: [] })).toThrow(/font/i)
  })

  it('returns a plugin with metadata, ogImage, no hooks', () => {
    const plugin = ogImagePlugin({ fonts: [fakeFont] })
    expect(plugin.name).toBe('og-image')
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.trust_level).toBe('untrusted')
    expect(plugin.metadata).toBeTypeOf('function')
    expect(plugin.ogImage).toBeDefined()
    expect(plugin.ogImage?.render).toBeTypeOf('function')
    expect(plugin.hooks).toBeUndefined()
  })

  it('metadata() returns the OG image URL with site.url trailing slash stripped', () => {
    const plugin = ogImagePlugin({ fonts: [fakeFont] })
    const m = plugin.metadata!(post, site)
    expect(m.openGraph?.images?.[0]?.url).toBe('https://example.com/og/hello')
    expect(m.openGraph?.images?.[0]?.width).toBe(1200)
    expect(m.openGraph?.images?.[0]?.height).toBe(630)
    expect(m.twitter?.card).toBe('summary_large_image')
    expect(m.twitter?.images?.[0]).toBe('https://example.com/og/hello')
  })

  it('respects a custom size in metadata', () => {
    const plugin = ogImagePlugin({
      fonts: [fakeFont],
      size: { width: 800, height: 418 },
    })
    const m = plugin.metadata!(post, site)
    expect(m.openGraph?.images?.[0]?.width).toBe(800)
    expect(m.openGraph?.images?.[0]?.height).toBe(418)
  })

  it("threads ogImage.fonts through unchanged", () => {
    const plugin = ogImagePlugin({ fonts: [fakeFont] })
    expect(plugin.ogImage?.fonts).toEqual([fakeFont])
  })

  it("'content' strategy calls ctx.image with the first body image", async () => {
    const plugin = ogImagePlugin({ fonts: [fakeFont], image: 'content' })
    let receivedUrl: string | null = null
    const ctx: OgImageRenderContext = {
      post: {
        ...post,
        format: 'markdown',
        body: '![alt](https://cdn.example.com/img.webp)',
      },
      site,
      async image(url) {
        receivedUrl = url
        return 'data:image/png;base64,XYZ'
      },
    }
    await plugin.ogImage!.render(ctx)
    expect(receivedUrl).toBe('https://cdn.example.com/img.webp')
  })

  it("'theme' strategy calls ctx.image with themeImageUrl", async () => {
    const plugin = ogImagePlugin({
      fonts: [fakeFont],
      image: 'theme',
      themeImageUrl: 'https://example.com/banner.png',
    })
    let receivedUrl: string | null = null
    const ctx: OgImageRenderContext = {
      post,
      site,
      async image(url) {
        receivedUrl = url
        return null
      },
    }
    await plugin.ogImage!.render(ctx)
    expect(receivedUrl).toBe('https://example.com/banner.png')
  })

  it("'none' strategy never calls ctx.image", async () => {
    const plugin = ogImagePlugin({ fonts: [fakeFont], image: 'none' })
    let called = false
    const ctx: OgImageRenderContext = {
      post,
      site,
      async image() {
        called = true
        return null
      },
    }
    await plugin.ogImage!.render(ctx)
    expect(called).toBe(false)
  })

  it('function strategy receives the post and site', async () => {
    let receivedPostId: string | null = null
    const plugin = ogImagePlugin({
      fonts: [fakeFont],
      image: (p) => {
        receivedPostId = p.postId
        return 'https://example.com/custom.png'
      },
    })
    let receivedUrl: string | null = null
    const ctx: OgImageRenderContext = {
      post,
      site,
      async image(url) {
        receivedUrl = url
        return null
      },
    }
    await plugin.ogImage!.render(ctx)
    expect(receivedPostId).toBe('p1')
    expect(receivedUrl).toBe('https://example.com/custom.png')
  })

  it('user-supplied render overrides the default', async () => {
    let renderCalled = false
    // Cast through unknown — the test only cares that the function is invoked,
    // not what it returns; the route is what feeds the element to ImageResponse.
    const fakeElement = { type: 'div', props: {}, key: null } as unknown as ReactElement
    const plugin = ogImagePlugin({
      fonts: [fakeFont],
      render: () => {
        renderCalled = true
        return fakeElement
      },
    })
    const ctx: OgImageRenderContext = {
      post,
      site,
      async image() {
        return null
      },
    }
    await plugin.ogImage!.render(ctx)
    expect(renderCalled).toBe(true)
  })
})
