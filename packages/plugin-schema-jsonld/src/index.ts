// @ampless/plugin-schema-jsonld — per-post JSON-LD structured data (Phase 4).
//
// Emits a single `<script type="application/ld+json">` element inside the post
// body via the `publicBodyForPost` hook. The script carries an Article-family
// schema.org object (Article / NewsArticle / BlogPosting / TechArticle) built
// from the post's own fields and four admin-managed settings.
//
// The runtime auto-escapes `<`, `>`, `&`, U+2028, U+2029 in the JSON body, so
// this plugin must NOT escape the body itself — double-escaping would produce
// invalid JSON-LD for consumers (Google Rich Results Test, schema-dts, etc.).
//
// Themes call `ampless.publicBodyForPost(post)` in their post template to
// render the descriptors. First-party themes (blog / corporate / dads / docs /
// landing / minimal) all do this automatically.

import {
  definePlugin,
  type AmplessPlugin,
  type Config,
  type PluginPublicRenderContext,
  type PublicPostBodyDescriptor,
  type Post,
} from 'ampless'

export interface SchemaJsonLdOptions {
  /**
   * Override the default schema.org `@type`. Falls back to the
   * `articleType` admin setting, then `'Article'`.
   */
  articleType?: 'Article' | 'NewsArticle' | 'BlogPosting' | 'TechArticle'
  /**
   * Override the author name. Falls back to the `authorName` admin
   * setting, then `site.name`.
   */
  authorName?: string
  /**
   * Override the publisher name. Falls back to the `publisherName`
   * admin setting, then `site.name`.
   */
  publisherName?: string
  /**
   * Override the publisher logo URL. Falls back to the `publisherLogo`
   * admin setting; omitted when empty.
   */
  publisherLogo?: string
  /**
   * Optional namespace when registering multiple instances (rare for
   * schema). Defaults to `'schema-jsonld'`.
   */
  instanceId?: string
}

const ARTICLE_TYPES = [
  'Article',
  'NewsArticle',
  'BlogPosting',
  'TechArticle',
] as const

type ArticleType = (typeof ARTICLE_TYPES)[number]

function normalizeBaseUrl(u: string): string {
  return u.endsWith('/') ? u : u + '/'
}

interface BuildSchemaOpts {
  articleType: ArticleType
  authorName: string
  publisherName: string
  publisherLogo: string
}

function buildSchema(
  post: Post,
  site: Config['site'],
  opts: BuildSchemaOpts
): Record<string, unknown> {
  // Build a canonical URL for the post. `encodeURIComponent` on the slug
  // handles slugs that contain special chars; most slugs are plain ASCII and
  // encode without change.
  const url = new URL(
    encodeURIComponent(post.slug),
    normalizeBaseUrl(site.url)
  ).toString()

  return {
    '@context': 'https://schema.org',
    '@type': opts.articleType,
    headline: post.title,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    author: { '@type': 'Person', name: opts.authorName },
    publisher: {
      '@type': 'Organization',
      name: opts.publisherName,
      ...(opts.publisherLogo
        ? { logo: { '@type': 'ImageObject', url: opts.publisherLogo } }
        : {}),
    },
    ...(post.tags?.length ? { keywords: post.tags.join(', ') } : {}),
  }
}

/**
 * Factory for the JSON-LD schema plugin. Returns a plugin manifest that
 * emits a single `<script type="application/ld+json">` per post via
 * `publicBodyForPost`. The plugin is `untrusted` — it only builds a pure
 * in-memory object from post fields and site config; it does not touch
 * DynamoDB, S3, or any Lambda processor.
 */
export default function schemaJsonLdPlugin(
  options: SchemaJsonLdOptions = {}
): AmplessPlugin {
  const instanceId = options.instanceId ?? 'schema-jsonld'

  return definePlugin({
    name: 'schema-jsonld',
    instanceId,
    apiVersion: 1,
    trust_level: 'untrusted',
    displayName: { en: 'JSON-LD Schema', ja: 'JSON-LD スキーマ' },
    capabilities: ['schema', 'adminSettings'],
    settings: {
      public: [
        {
          type: 'select',
          key: 'articleType',
          label: { en: 'Article type', ja: 'アーティクル種別' },
          description: {
            en: 'schema.org @type used for posts.',
            ja: '投稿に使う schema.org の @type。',
          },
          default: options.articleType ?? 'Article',
          options: ARTICLE_TYPES.map((v) => ({
            value: v,
            label: { en: v, ja: v },
          })),
        },
        {
          type: 'text',
          key: 'authorName',
          label: { en: 'Author name', ja: '著者名' },
          description: {
            en: 'Displayed as the article author. Leave empty to use site.name.',
            ja: '記事の著者として表示されます。空欄で site.name を使用。',
          },
          default: options.authorName ?? '',
        },
        {
          type: 'text',
          key: 'publisherName',
          label: { en: 'Publisher name', ja: '発行者名' },
          description: {
            en: 'Displayed as the publisher organization. Leave empty to use site.name.',
            ja: '発行組織として表示されます。空欄で site.name を使用。',
          },
          default: options.publisherName ?? '',
        },
        {
          type: 'url',
          key: 'publisherLogo',
          label: { en: 'Publisher logo URL', ja: '発行者ロゴ URL' },
          description: {
            en: 'Absolute URL of the publisher logo image. Leave empty to omit the logo from the schema.',
            ja: '発行者ロゴ画像の絶対 URL。空欄でスキーマからロゴを省略します。',
          },
          default: options.publisherLogo ?? '',
        },
      ],
    },

    publicBodyForPost(
      post: Post,
      ctx: PluginPublicRenderContext
    ): readonly PublicPostBodyDescriptor[] {
      const site = ctx.site

      const rawType = (ctx.setting<string>('articleType') ?? '').trim()
      const articleType: ArticleType =
        (ARTICLE_TYPES as readonly string[]).includes(rawType)
          ? (rawType as ArticleType)
          : (options.articleType ?? 'Article')

      const authorName =
        (ctx.setting<string>('authorName') ?? '').trim() ||
        options.authorName?.trim() ||
        site.name

      const publisherName =
        (ctx.setting<string>('publisherName') ?? '').trim() ||
        options.publisherName?.trim() ||
        site.name

      const publisherLogo =
        (ctx.setting<string>('publisherLogo') ?? '').trim() ||
        (options.publisherLogo ?? '').trim()

      const schema = buildSchema(post, site, {
        articleType,
        authorName,
        publisherName,
        publisherLogo,
      })

      return [
        {
          type: 'inlineScript',
          id: `schema-jsonld-${instanceId}`,
          scriptType: 'application/ld+json',
          // JSON.stringify produces valid JSON; the runtime auto-escapes
          // </script>-breaking chars so we must NOT escape them here.
          body: JSON.stringify(schema),
        },
      ]
    },
  })
}
