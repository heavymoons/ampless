import { describe, it, expect, vi } from 'vitest'

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

vi.mock('@aws-amplify/adapter-nextjs/api', () => ({
  generateServerClientUsingReqRes: () => ({
    queries: {
      listPublishedPosts: async () => ({ data: { items: [], nextToken: null }, errors: null }),
      getPublishedPost: async () => ({ data: null, errors: null }),
      listPostsByTag: async () => ({ data: { items: [], nextToken: null }, errors: null }),
    },
  }),
}))

import { createAmpless } from './index.js'
import type { ThemeModule } from 'ampless'

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

    it('returns the base string unchanged when the post has no classes', () => {
      expect(a.postBodyClassName({}, base)).toBe(base)
      expect(a.postBodyClassName({ metadata: { cache: 'deep' } }, base)).toBe(base)
      expect(a.postBodyClassName({ metadata: { postClasses: [] } }, base)).toBe(base)
      expect(a.postBodyClassName({})).toBe('')
    })

    it('drops invalid ids, including attribute break-out attempts', () => {
      expect(
        a.postBodyClassName({ metadata: { postClasses: ['x" onmouseover=alert(1)', 'Wide', 'a b', 7] as never } }, base),
      ).toBe(base)
      expect(a.postBodyClassName({ metadata: { postClasses: 'wide' as never } }, base)).toBe(base)
    })

    it('appends ampless-post--<id> in stored order, de-duplicated', () => {
      expect(a.postBodyClassName({ metadata: { postClasses: ['serif', 'wide', 'serif'] } }, base)).toBe(
        `${base} ampless-post--serif ampless-post--wide`,
      )
      expect(a.postBodyClassName({ metadata: { postClasses: ['wide'] } })).toBe('ampless-post--wide')
    })
  })
})
