import { describe, it, expect } from 'vitest'
import { createSeo } from './seo.js'
import type { SiteSettingsApi, EffectiveSiteSettings } from './site-settings.js'

function makeSettingsApi(overrides: Partial<EffectiveSiteSettings['site']>): SiteSettingsApi {
  return {
    loadSiteSettings: async () => ({
      site: {
        name: 'Default Name',
        url: 'https://example.com',
        ...overrides,
      },
      media: {},
    }),
  }
}

describe('createSeo.siteMetadata — title coercion', () => {
  it('coerces a numeric site.name to a string in siteMetadata title', async () => {
    // Inject a settings api that returns a numeric name to simulate the
    // worst case where normalization in site-settings is somehow bypassed.
    const settingsApi: SiteSettingsApi = {
      loadSiteSettings: async () => ({
        site: {
          // Cast: intentionally violates the type to replicate the runtime bug
          name: 1470 as unknown as string,
          url: 'https://example.com',
        },
        media: {},
      }),
    }

    const seo = createSeo(
      { site: { name: 'Fallback', url: 'https://example.com' }, plugins: [] },
      settingsApi
    )

    const meta = await seo.siteMetadata()

    expect(typeof meta.title).toBe('string')
    expect(meta.title).toBe('1470')
  })

  it('returns the site name as a string when already a string', async () => {
    const seo = createSeo(
      { site: { name: 'My Blog', url: 'https://example.com' }, plugins: [] },
      makeSettingsApi({ name: 'My Blog' })
    )

    const meta = await seo.siteMetadata()

    expect(typeof meta.title).toBe('string')
    expect(meta.title).toBe('My Blog')
  })
})
