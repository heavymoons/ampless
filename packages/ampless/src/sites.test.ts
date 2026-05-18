import { describe, it, expect } from 'vitest'
import type { Config } from './types.js'
import {
  DEFAULT_SITE_ID,
  resolveSiteId,
  isMultiSite,
  siteFor,
  composeSiteIdStatus,
} from './sites.js'

const single: Config = {
  site: { name: 'Solo', url: 'https://solo.example.com' },
}

const multi: Config = {
  site: { name: 'Defaults', url: 'https://defaults.example.com', description: 'def' },
  sites: {
    blog: {
      domains: ['blog.example.com', 'www.example.com'],
      name: 'Blog',
      url: 'https://blog.example.com',
    },
    docs: {
      domains: ['DOCS.example.com'],
      name: 'Docs',
      // url falls through to default
    },
  },
}

describe('resolveSiteId', () => {
  it('returns "default" in single-site mode regardless of host', () => {
    expect(resolveSiteId('whatever.example.com', single)).toBe(DEFAULT_SITE_ID)
    expect(resolveSiteId('localhost', single)).toBe(DEFAULT_SITE_ID)
  })

  it('returns "default" when sites is empty object', () => {
    expect(resolveSiteId('any.example.com', { ...single, sites: {} })).toBe(DEFAULT_SITE_ID)
  })

  it('matches hostname against each site domains list (case-insensitive)', () => {
    expect(resolveSiteId('blog.example.com', multi)).toBe('blog')
    expect(resolveSiteId('Blog.Example.Com', multi)).toBe('blog')
    expect(resolveSiteId('docs.example.com', multi)).toBe('docs')
  })

  it('matches alternate domains within a single site', () => {
    expect(resolveSiteId('www.example.com', multi)).toBe('blog')
  })

  it('returns null when host is not registered', () => {
    expect(resolveSiteId('unknown.example.com', multi)).toBeNull()
  })

  it('returns the single declared site for any host (catch-all, matches isMultiSite)', () => {
    const oneSite: Config = {
      ...single,
      sites: { default: { domains: ['ampless.example.com'] } },
    }
    expect(resolveSiteId('ampless.example.com', oneSite)).toBe('default')
    expect(resolveSiteId('localhost', oneSite)).toBe('default')
    expect(resolveSiteId('whatever', oneSite)).toBe('default')
  })
})

describe('isMultiSite', () => {
  it('false when no sites', () => {
    expect(isMultiSite(single)).toBe(false)
  })

  it('false when sites is empty', () => {
    expect(isMultiSite({ ...single, sites: {} })).toBe(false)
  })

  it('false when only one site declared (still single-site mode)', () => {
    expect(
      isMultiSite({
        ...single,
        sites: { blog: { domains: ['blog.example.com'] } },
      })
    ).toBe(false)
  })

  it('true when 2+ sites declared', () => {
    expect(isMultiSite(multi)).toBe(true)
  })
})

describe('siteFor', () => {
  it('returns top-level defaults for single-site / unmatched siteId', () => {
    expect(siteFor(DEFAULT_SITE_ID, single)).toEqual({
      name: 'Solo',
      url: 'https://solo.example.com',
      description: undefined,
    })
  })

  it('overrides per-site name/url/description', () => {
    expect(siteFor('blog', multi)).toEqual({
      name: 'Blog',
      url: 'https://blog.example.com',
      description: 'def',
    })
  })

  it('falls through to defaults when override is missing', () => {
    expect(siteFor('docs', multi)).toEqual({
      name: 'Docs',
      url: 'https://defaults.example.com',
      description: 'def',
    })
  })

  it('returns defaults when siteId is unknown', () => {
    expect(siteFor('nonexistent', multi)).toEqual({
      name: 'Defaults',
      url: 'https://defaults.example.com',
      description: 'def',
    })
  })
})

describe('composeSiteIdStatus', () => {
  it('joins siteId and status with "#"', () => {
    expect(composeSiteIdStatus('default', 'published')).toBe('default#published')
    expect(composeSiteIdStatus('blog', 'draft')).toBe('blog#draft')
  })
})
