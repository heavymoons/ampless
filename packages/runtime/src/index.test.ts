import { afterEach, describe, it, expect, vi } from 'vitest'

// next/headers / next/navigation are unavailable outside a Next.js
// request context. The runtime accesses them at call time, not at
// `createAmpless` time, so mocking them here keeps the smoke test
// from booting Next's request handler.
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
  headers: async () => new Map(),
}))

vi.mock('@aws-amplify/adapter-nextjs', () => ({
  createServerRunner: () => ({
    runWithAmplifyServerContext: async ({
      operation,
    }: {
      operation: (ctx: unknown) => unknown
    }) => operation({}),
  }),
}))

// Items the mocked `listPublishedPosts` returns (wire shape: AWSJSON
// strings for body / metadata). Empty unless a test fills it.
const mockList = vi.hoisted(() => ({ items: [] as unknown[] }))

vi.mock('@aws-amplify/adapter-nextjs/api', () => ({
  generateServerClientUsingReqRes: () => ({
    queries: {
      listPublishedPosts: async () => ({ data: { items: mockList.items, nextToken: null }, errors: null }),
      getPublishedPost: async () => ({ data: null, errors: null }),
      listPostsByTag: async () => ({ data: { items: [], nextToken: null }, errors: null }),
    },
  }),
}))

import { createAmpless } from './index.js'
import { POST_CLASSES_METADATA_KEY, POST_CLASSES_METADATA_KIND } from 'ampless'
import type { Post, PostMetadata, ThemeModule } from 'ampless'

const fakeTheme: ThemeModule = {
  name: 'fake',
  manifest: { name: 'fake', label: 'Fake', fields: [] },
  components: {
    Home: () => null,
  },
}

describe('createAmpless', () => {
  it('returns an object exposing the documented surface', () => {
    const a = createAmpless({
      outputs: {},
      cmsConfig: { site: { name: 'X', url: 'https://x.example.com' } },
      themes: { themes: { fake: fakeTheme }, defaultTheme: 'fake' },
    })

    // Direct delegates
    expect(typeof a.listPublishedPosts).toBe('function')
    expect(typeof a.getPublishedPost).toBe('function')
    expect(typeof a.listPostsByTag).toBe('function')
    expect(typeof a.loadSiteSettings).toBe('function')
    expect(typeof a.resolveActiveTheme).toBe('function')
    expect(typeof a.loadThemeConfig).toBe('function')
    expect(typeof a.postMetadata).toBe('function')
    expect(typeof a.siteMetadata).toBe('function')
    expect(typeof a.renderBody).toBe('function')
    expect(typeof a.postBodyClassName).toBe('function')
    expect(typeof a.renderThemeCss).toBe('function')
    expect(typeof a.publicAssetUrl).toBe('function')
    expect(typeof a.isStorageConfigured).toBe('function')

    // Sub-APIs
    expect(typeof a.posts.listPublishedPosts).toBe('function')
    expect(typeof a.settings.loadSiteSettings).toBe('function')
    expect(typeof a.seo.postMetadata).toBe('function')
    expect(typeof a.themeActive.resolveActiveTheme).toBe('function')
    expect(typeof a.themeConfig.loadThemeConfig).toBe('function')
    expect(typeof a.storageApi.publicAssetUrl).toBe('function')

    // Pass-through readonly fields
    expect(a.cmsConfig.site.name).toBe('X')
    expect(a.themes.defaultTheme).toBe('fake')
  })

  it('isStorageConfigured returns false when outputs lacks storage', () => {
    const a = createAmpless({
      outputs: {},
      cmsConfig: { site: { name: 'X', url: 'https://x.example.com' } },
      themes: { themes: { fake: fakeTheme }, defaultTheme: 'fake' },
    })
    expect(a.isStorageConfigured()).toBe(false)
  })

  it('isStorageConfigured returns true when outputs has storage', () => {
    const a = createAmpless({
      outputs: { storage: { bucket_name: 'b', aws_region: 'us-east-1' } },
      cmsConfig: { site: { name: 'X', url: 'https://x.example.com' } },
      themes: { themes: { fake: fakeTheme }, defaultTheme: 'fake' },
    })
    expect(a.isStorageConfigured()).toBe(true)
    expect(a.publicAssetUrl('public/foo.json')).toBe(
      'https://b.s3.us-east-1.amazonaws.com/public/foo.json'
    )
  })

  describe('postBodyClassName', () => {
    const a = createAmpless({
      outputs: {},
      cmsConfig: { site: { name: 'X', url: 'https://x.example.com' } },
      themes: { themes: { fake: fakeTheme }, defaultTheme: 'fake' },
    })
    const base = 'prose prose-neutral dark:prose-invert max-w-none'
    const tagged = (ids: unknown): PostMetadata => ({
      [POST_CLASSES_METADATA_KEY]: { kind: POST_CLASSES_METADATA_KIND, version: 1, ids },
    })

    const themed = (metadata?: PostMetadata): Pick<Post, 'format' | 'metadata'> => ({ format: 'tiptap', metadata })

    it('returns the base string unchanged when the post has no classes', () => {
      expect(a.postBodyClassName(themed(), base)).toBe(base)
      expect(a.postBodyClassName(themed('{"ampless:postClasses":{}}' as never), base)).toBe(base)
      expect(a.postBodyClassName(themed({ cache: 'deep' }), base)).toBe(base)
      expect(a.postBodyClassName(themed(tagged([])), base)).toBe(base)
      expect(a.postBodyClassName(themed())).toBe('')
    })

    it('drops invalid ids, including attribute break-out attempts', () => {
      expect(a.postBodyClassName(themed(tagged(['x" onmouseover=alert(1)', 'Wide', 'a b', 7])), base)).toBe(base)
      expect(a.postBodyClassName(themed(tagged('wide')), base)).toBe(base)
    })

    it('appends ampless-post--<id> in stored order, de-duplicated', () => {
      expect(a.postBodyClassName(themed(tagged(['serif', 'wide', 'serif'])), base)).toBe(
        `${base} ampless-post--serif ampless-post--wide`,
      )
      expect(a.postBodyClassName(themed(tagged(['wide'])))).toBe('ampless-post--wide')
    })

    it('renders existing posts exactly as before, whatever they store under postClasses', () => {
      // Typed as Post so `tsc --noEmit` checks that legacy metadata shapes
      // still compile against the public Post / PostMetadata types.
      const legacyPost = (metadata: PostMetadata): Post => ({
        postId: 'p',
        slug: 'p',
        title: 'T',
        format: 'tiptap',
        body: {},
        status: 'published',
        metadata,
      })
      const legacyPosts: Post[] = [
        legacyPost({ postClasses: ['wide', 'serif'] }),
        legacyPost({ postClasses: { theme: 'x' } }),
        legacyPost({ postClasses: 'wide' }),
        legacyPost({ no_layout: false, cache: 'hot', seo: { title: 't' } }),
        legacyPost({ 'ampless:postClasses': ['wide'] }),
      ]
      for (const post of legacyPosts) expect(a.postBodyClassName(post, base)).toBe(base)
    })

    it('never applies post classes to static or no_layout HTML posts, even with the tagged value', () => {
      const withClasses = tagged(['wide'])
      const post = (format: Post['format'], metadata: PostMetadata): Pick<Post, 'format' | 'metadata'> => ({
        format,
        metadata,
      })
      expect(a.postBodyClassName(post('tiptap', withClasses), base)).toBe(`${base} ampless-post--wide`)
      expect(a.postBodyClassName(post('static', withClasses), base)).toBe(base)
      expect(a.postBodyClassName(post('html', { ...withClasses, no_layout: true }), base)).toBe(base)
      // Same rule as the middleware: no_layout only matters for html, and only when exactly true.
      expect(a.postBodyClassName(post('html', withClasses), base)).toBe(`${base} ampless-post--wide`)
      expect(a.postBodyClassName(post('html', { ...withClasses, no_layout: 'true' as never }), base)).toBe(
        `${base} ampless-post--wide`,
      )
      expect(a.postBodyClassName(post('tiptap', { ...withClasses, no_layout: true }), base)).toBe(
        `${base} ampless-post--wide`,
      )
    })

    describe('home page featured slot', () => {
      // The bundled blog / corporate / dads / landing home pages render the
      // newest post as `featured` inside a wrapper whose class comes from
      // `ampless.postBodyClassName(featured, ...)`, whatever its format.
      const homeBase = 'prose prose-neutral dark:prose-invert mt-6 max-w-none'
      const tagJson = (extra: Record<string, unknown> = {}) =>
        JSON.stringify({ ...tagged(['wide']), ...extra })
      const staticBody = { entrypoint: 'index.html', files: ['index.html'], uploadedAt: '2026-01-01T00:00:00.000Z' }
      const wirePost = (slug: string, format: string, metadata: string | null) => ({
        postId: slug,
        slug,
        title: slug,
        format,
        body: JSON.stringify(format === 'static' ? staticBody : 'x'),
        status: 'published',
        publishedAt: '2026-01-01T00:00:00.000Z',
        tags: [],
        metadata,
      })

      afterEach(() => {
        mockList.items = []
      })

      it('keeps static and no_layout featured posts unchanged and applies classes to themed ones', async () => {
        mockList.items = [
          wirePost('static-tagged', 'static', tagJson()),
          wirePost('raw-tagged', 'html', tagJson({ no_layout: true })),
          wirePost('static-plain', 'static', null),
          wirePost('static-legacy', 'static', JSON.stringify({ postClasses: ['wide'] })),
          wirePost('themed-tagged', 'markdown', tagJson()),
          wirePost('themed-legacy', 'markdown', JSON.stringify({ postClasses: ['wide'] })),
        ]
        const { items } = await a.listPublishedPosts()
        expect(items).toHaveLength(6)
        const classFor = Object.fromEntries(items.map((p) => [p.slug, a.postBodyClassName(p, homeBase)]))
        expect(classFor).toEqual({
          'static-tagged': homeBase,
          'raw-tagged': homeBase,
          'static-plain': homeBase,
          'static-legacy': homeBase,
          'themed-tagged': `${homeBase} ampless-post--wide`,
          'themed-legacy': homeBase,
        })
      })
    })
  })
})
