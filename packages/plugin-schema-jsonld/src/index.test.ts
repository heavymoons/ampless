import { describe, it, expect } from 'vitest'
import type {
  AmplessPlugin,
  PluginPublicRenderContext,
} from 'ampless'
import { resolvePluginSettings } from 'ampless'
import schemaJsonLdPlugin from './index.js'

// ---------------------------------------------------------------------------
// Test helpers — mirrors the pattern from plugin-analytics-ga4/src/index.test.ts
// ---------------------------------------------------------------------------

const site: PluginPublicRenderContext['site'] = {
  name: 'Test Site',
  url: 'https://example.com/',
}

const siteNoTrailingSlash: PluginPublicRenderContext['site'] = {
  name: 'Test Site',
  url: 'https://example.com/blog',
}

const siteTrailingSlash: PluginPublicRenderContext['site'] = {
  name: 'Test Site',
  url: 'https://example.com/blog/',
}

type MinimalPost = Parameters<NonNullable<AmplessPlugin['publicBodyForPost']>>[0]

function makePost(overrides: Partial<MinimalPost> = {}): MinimalPost {
  return {
    postId: 'post-1',
    slug: 'hello-world',
    title: 'Hello World',
    format: 'markdown',
    body: '',
    status: 'published',
    ...overrides,
  }
}

/**
 * Resolves settings and calls `publicBodyForPost`, returning the
 * parsed JSON-LD object from the first descriptor's body.
 */
function callPublicBodyForPost(
  plugin: AmplessPlugin,
  post: MinimalPost = makePost(),
  stored: Record<string, unknown> = {},
  overrideSite: PluginPublicRenderContext['site'] = site
): Record<string, unknown> {
  const resolved = resolvePluginSettings(plugin.settings, stored)
  const ctx: PluginPublicRenderContext = {
    site: overrideSite,
    setting<T = unknown>(key: string): T | undefined {
      const v = resolved[key]
      return v === undefined ? undefined : (v as T)
    },
  }
  const descriptors = plugin.publicBodyForPost?.(post, ctx) ?? []
  expect(descriptors).toHaveLength(1)
  const d = descriptors[0]!
  expect(d.type).toBe('inlineScript')
  if (d.type === 'inlineScript') {
    return JSON.parse(d.body) as Record<string, unknown>
  }
  throw new Error('unexpected descriptor type')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('schemaJsonLdPlugin', () => {
  it('plugin.apiVersion === 1', () => {
    expect(schemaJsonLdPlugin().apiVersion).toBe(1)
  })

  it('plugin.name === "schema-jsonld"', () => {
    expect(schemaJsonLdPlugin().name).toBe('schema-jsonld')
  })

  it('declares capabilities [schema, adminSettings]', () => {
    const plugin = schemaJsonLdPlugin()
    expect(plugin.capabilities).toEqual(
      expect.arrayContaining(['schema', 'adminSettings'])
    )
    expect(plugin.capabilities).toHaveLength(2)
  })

  it('defaults instanceId to "schema-jsonld"', () => {
    expect(schemaJsonLdPlugin().instanceId).toBe('schema-jsonld')
  })

  it('honors an explicit instanceId', () => {
    const plugin = schemaJsonLdPlugin({ instanceId: 'my-schema' })
    expect(plugin.instanceId).toBe('my-schema')
  })

  it('descriptor id follows schema-jsonld-<instanceId> pattern (default)', () => {
    const plugin = schemaJsonLdPlugin()
    const resolved = resolvePluginSettings(plugin.settings, {})
    const ctx: PluginPublicRenderContext = {
      site,
      setting<T = unknown>(key: string): T | undefined {
        return resolved[key] as T | undefined
      },
    }
    const descriptors = plugin.publicBodyForPost?.(makePost(), ctx) ?? []
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]!.id).toBe('schema-jsonld-schema-jsonld')
  })

  it('descriptor id follows schema-jsonld-<instanceId> pattern (custom instanceId)', () => {
    const plugin = schemaJsonLdPlugin({ instanceId: 'blog-schema' })
    const resolved = resolvePluginSettings(plugin.settings, {})
    const ctx: PluginPublicRenderContext = {
      site,
      setting<T = unknown>(key: string): T | undefined {
        return resolved[key] as T | undefined
      },
    }
    const descriptors = plugin.publicBodyForPost?.(makePost(), ctx) ?? []
    expect(descriptors[0]!.id).toBe('schema-jsonld-blog-schema')
  })

  it('descriptor scriptType is "application/ld+json"', () => {
    const plugin = schemaJsonLdPlugin()
    const resolved = resolvePluginSettings(plugin.settings, {})
    const ctx: PluginPublicRenderContext = {
      site,
      setting<T = unknown>(key: string): T | undefined {
        return resolved[key] as T | undefined
      },
    }
    const descriptors = plugin.publicBodyForPost?.(makePost(), ctx) ?? []
    expect(descriptors).toHaveLength(1)
    const d = descriptors[0]!
    if (d.type === 'inlineScript') {
      expect(d.scriptType).toBe('application/ld+json')
    } else {
      throw new Error('expected inlineScript descriptor')
    }
  })

  it('emits valid Article schema for a basic post', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin)
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Article')
    expect(schema.headline).toBe('Hello World')
    expect(schema.url).toContain('hello-world')
  })

  it('sets mainEntityOfPage with @type WebPage', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin)
    const meo = schema.mainEntityOfPage as Record<string, unknown>
    expect(meo['@type']).toBe('WebPage')
    expect(meo['@id']).toContain('hello-world')
  })

  it('sets author.@type to Person', () => {
    const plugin = schemaJsonLdPlugin({ authorName: 'Jane Doe' })
    const schema = callPublicBodyForPost(plugin)
    const author = schema.author as Record<string, unknown>
    expect(author['@type']).toBe('Person')
    expect(author.name).toBe('Jane Doe')
  })

  it('sets publisher.@type to Organization', () => {
    const plugin = schemaJsonLdPlugin({ publisherName: 'Acme Corp' })
    const schema = callPublicBodyForPost(plugin)
    const publisher = schema.publisher as Record<string, unknown>
    expect(publisher['@type']).toBe('Organization')
    expect(publisher.name).toBe('Acme Corp')
  })

  it('omits description when post.excerpt is absent', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin, makePost({ excerpt: undefined }))
    expect(schema).not.toHaveProperty('description')
  })

  it('includes description when post.excerpt is present', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(
      plugin,
      makePost({ excerpt: 'A short summary.' })
    )
    expect(schema.description).toBe('A short summary.')
  })

  it('omits keywords when post.tags is absent', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin, makePost({ tags: undefined }))
    expect(schema).not.toHaveProperty('keywords')
  })

  it('includes keywords as comma-separated list when post.tags present', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin, makePost({ tags: ['a', 'b'] }))
    expect(schema.keywords).toBe('a, b')
  })

  it('admin setting articleType overrides the default', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin, makePost(), {
      articleType: 'NewsArticle',
    })
    expect(schema['@type']).toBe('NewsArticle')
  })

  it('constructor articleType option becomes the default', () => {
    const plugin = schemaJsonLdPlugin({ articleType: 'BlogPosting' })
    const schema = callPublicBodyForPost(plugin)
    expect(schema['@type']).toBe('BlogPosting')
  })

  it('authorName falls back to site.name when empty', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin)
    const author = schema.author as Record<string, unknown>
    expect(author.name).toBe(site.name)
  })

  it('publisherName falls back to site.name when empty', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin)
    const publisher = schema.publisher as Record<string, unknown>
    expect(publisher.name).toBe(site.name)
  })

  it('omits publisher.logo when publisherLogo is empty', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin)
    const publisher = schema.publisher as Record<string, unknown>
    expect(publisher).not.toHaveProperty('logo')
  })

  it('includes publisher.logo when publisherLogo is set via constructor', () => {
    const plugin = schemaJsonLdPlugin({
      publisherLogo: 'https://example.com/logo.png',
    })
    const schema = callPublicBodyForPost(plugin)
    const publisher = schema.publisher as Record<string, unknown>
    const logo = publisher.logo as Record<string, unknown>
    expect(logo['@type']).toBe('ImageObject')
    expect(logo.url).toBe('https://example.com/logo.png')
  })

  it('includes publisher.logo when publisherLogo is set via admin setting', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(plugin, makePost(), {
      publisherLogo: 'https://example.com/admin-logo.png',
    })
    const publisher = schema.publisher as Record<string, unknown>
    const logo = publisher.logo as Record<string, unknown>
    expect(logo.url).toBe('https://example.com/admin-logo.png')
  })

  it('url includes the post slug relative to site.url (trailing slash)', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(
      plugin,
      makePost({ slug: 'my-post' }),
      {},
      siteTrailingSlash
    )
    expect(schema.url).toBe('https://example.com/blog/my-post')
  })

  it('url is correct when site.url has no trailing slash', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(
      plugin,
      makePost({ slug: 'my-post' }),
      {},
      siteNoTrailingSlash
    )
    expect(schema.url).toBe('https://example.com/blog/my-post')
  })

  it('url encodes URL-unsafe characters in the slug', () => {
    const plugin = schemaJsonLdPlugin()
    const schema = callPublicBodyForPost(
      plugin,
      makePost({ slug: '日本語スラッグ' }),
      {},
      site
    )
    const url = schema.url as string
    expect(() => new URL(url)).not.toThrow()
    // encoded form must not contain raw Japanese characters
    expect(url).not.toMatch(/[　-鿿]/)
  })

  it('exposes 4 settings.public fields (articleType, authorName, publisherName, publisherLogo)', () => {
    const plugin = schemaJsonLdPlugin()
    const fields = plugin.settings?.public ?? []
    expect(fields.map((f) => f.key)).toEqual([
      'articleType',
      'authorName',
      'publisherName',
      'publisherLogo',
    ])
  })

  // --- admin empty-string explicitly overrides constructor option ------
  //
  // Regression guards for the design rule that constructor options ONLY
  // seed the manifest default; once admin saves anything (including ''),
  // that stored value wins. Re-falling-back to the constructor option at
  // runtime would let it resurrect when the admin explicitly disables a
  // field, breaking the documented "leave empty to use site.name / omit
  // the logo" contract.

  it('admin authorName="" wins over constructor authorName (falls back to site.name)', () => {
    const plugin = schemaJsonLdPlugin({ authorName: 'Constructor Author' })
    const schema = callPublicBodyForPost(plugin, makePost(), { authorName: '' })
    const author = schema.author as Record<string, unknown>
    expect(author.name).toBe(site.name)
  })

  it('admin publisherName="" wins over constructor publisherName (falls back to site.name)', () => {
    const plugin = schemaJsonLdPlugin({ publisherName: 'Constructor Publisher' })
    const schema = callPublicBodyForPost(plugin, makePost(), {
      publisherName: '',
    })
    const publisher = schema.publisher as Record<string, unknown>
    expect(publisher.name).toBe(site.name)
  })

  it('admin publisherLogo="" wins over constructor publisherLogo (logo omitted)', () => {
    const plugin = schemaJsonLdPlugin({
      publisherLogo: 'https://example.com/ctor-logo.png',
    })
    const schema = callPublicBodyForPost(plugin, makePost(), {
      publisherLogo: '',
    })
    const publisher = schema.publisher as Record<string, unknown>
    expect(publisher).not.toHaveProperty('logo')
  })

  // --- publisherLogo field disallows relative URLs ---------------------

  it('publisherLogo field declares allowRelative: false', () => {
    const plugin = schemaJsonLdPlugin()
    const fields = plugin.settings?.public ?? []
    const logoField = fields.find((f) => f.key === 'publisherLogo')
    expect(logoField).toBeDefined()
    if (logoField?.type === 'url') {
      expect(logoField.allowRelative).toBe(false)
    } else {
      throw new Error('publisherLogo field should be a url field')
    }
  })
})
