# @ampless/plugin-seo

SEO plugin for [ampless](https://github.com/heavymoons/ampless). Generates per-post and per-site metadata (Open Graph, Twitter card, canonical) and keeps a `sitemap.xml` regenerated to S3 whenever the post set changes.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

## Install

```bash
npm install @ampless/plugin-seo@alpha
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'

export default defineConfig({
  // ...
  plugins: [
    seoPlugin({
      // defaultOgImage: 'https://example.com/og-default.png',
      // twitterSite: '@example',
      // twitterCreator: '@author',
      // twitterCard: 'summary_large_image',
    }),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `defaultOgImage` | none | Falls through to `og:image` and `twitter:image` for every post when set |
| `twitterSite` | none | `@handle` of the site |
| `twitterCreator` | none | `@handle` of the post author |
| `twitterCard` | `'summary_large_image'` | Card style |
| `siteUrl` | `site.url` | Override base URL (e.g. for staging) |
| `priority` / `changefreq` / `limit` | (sitemap defaults) | Sitemap entry tuning |

## What it produces

- **Per-post metadata** (Next.js `generateMetadata` shape): `title`, `description`, `alternates.canonical`, `openGraph` (article type, url, images), `twitter` (card, handles, images)
- **Site-level metadata**: defaults for the root layout — title, description, og:website
- **`/sitemap.xml`** — full URL set, regenerated to `s3://<bucket>/public/plugins/seo/sitemap.xml` on every `content.published` / `content.unpublished` / `content.deleted` / `content.updated` event. Served by the template's `/sitemap.xml` route handler.

## Trust level

`trusted` — the sitemap regeneration runs in the trusted Lambda processor with read access to the post table and write access under `public/plugins/seo/` in the site's S3 bucket. The metadata helpers (`metadata` / `siteMetadata`) are pure functions that run during Next.js SSR and do not need any AWS access.

## License

[MIT](../../LICENSE)
