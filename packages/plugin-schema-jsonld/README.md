> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-schema-jsonld

JSON-LD structured data (Article schema) plugin for [ampless](https://github.com/heavymoons/ampless).

> **Pre-release / beta.** Breaking changes possible in any minor version until v1.0.

Emits a `<script type="application/ld+json">` element inside the post body via the `publicBodyForPost` hook (Phase 4). The script carries an Article-family [schema.org](https://schema.org/) object built from the post's fields and four admin-managed settings.

No AWS data permissions are required — the plugin is a pure function that runs at request time inside the public Next.js process. The plugin's `trust_level` is `untrusted`.

## Install

```bash
npm install @ampless/plugin-schema-jsonld@beta
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import schemaJsonLdPlugin from '@ampless/plugin-schema-jsonld'

export default defineConfig({
  // ...
  plugins: [
    schemaJsonLdPlugin(),
  ],
})
```

All options are optional. The plugin works out of the box and falls back to `site.name` for author / publisher:

```ts
schemaJsonLdPlugin({
  articleType:    'BlogPosting',   // default: 'Article'
  authorName:     'Jane Smith',    // default: site.name
  publisherName:  'Acme Blog',     // default: site.name
  publisherLogo:  'https://example.com/logo.png',  // default: omitted
})
```

| Option | Default | Notes |
|---|---|---|
| `articleType` | `'Article'` | schema.org `@type`. One of `Article`, `NewsArticle`, `BlogPosting`, `TechArticle`. Can be overridden per-site from `/admin/plugins`. |
| `authorName` | `site.name` | Author `Person` name in the schema. Empty string or absent → `site.name`. |
| `publisherName` | `site.name` | Publisher `Organization` name. Empty string or absent → `site.name`. |
| `publisherLogo` | _(omitted)_ | Absolute URL of the publisher logo image. Empty string or absent → logo omitted from the schema. |
| `instanceId` | `'schema-jsonld'` | Namespace for the script element id. Needed only when registering two instances. |

## Admin-managed settings

The four options above are also exposed as admin-editable fields at `/admin/plugins`. Values stored there take precedence over the constructor options, so teams can update them without redeploying the site.

## Choosing an Article type

| `@type` | Use when |
|---|---|
| `Article` | General-purpose default. Works for most blogs and company news. |
| `BlogPosting` | Personal blog or informal writing. Google treats it like `Article` for rich results. |
| `NewsArticle` | News and journalism sites. Eligible for Google News rich results. |
| `TechArticle` | Technical documentation or how-to guides. |

See [Google's structured data documentation](https://developers.google.com/search/docs/appearance/structured-data/article) for eligibility guidelines.

## Verify with Google Rich Results Test

After deploying, verify the output at:

**<https://search.google.com/test/rich-results>**

1. Enter the URL of any post on your site.
2. The tool parses the `<script type="application/ld+json">` block and shows detected entity types.
3. A green "Valid items detected" result means the schema is well-formed.

## Trust level

`untrusted`. The plugin only contributes body descriptors that are validated and rendered by `@ampless/runtime`. It does not touch DynamoDB, S3, or any Lambda processor.

## Known limitations

- **author/publisher fallback to `site.name`** — the plugin does not have access to per-post author records. When `authorName` and `publisherName` are empty (default), both use `site.name`. Set a real author name via the admin settings or the constructor option.
- **tags → `keywords`** — `post.tags` (when present) are joined with `, ` and written to the `keywords` field. This is a flat comma-separated string, which matches common structured-data consumers; it is not an `ItemList`.
- **home page / listing routes** — `publicBodyForPost` is only called for individual post pages. Index, tag-listing, and other non-post routes do not receive the descriptor.
- **`BlogPosting` vs `Article` for Google** — Google treats both types identically for Article rich results. Prefer `BlogPosting` for informal writing, `Article` for editorial content, and `NewsArticle` only if you operate a news publication.
- **image field** — the schema does not include an `image` field. If your posts have a cover image URL, consider extending the plugin in a future release.
