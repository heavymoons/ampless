# @ampless/plugin-rss

RSS 2.0 feed plugin for [ampless](https://github.com/heavymoons/ampless).

Regenerates `feed.xml` to S3 every time a post is published, unpublished, updated, or deleted. The Next.js `/feed.xml` route serves the latest version through.

## Install

```bash
npm install @ampless/plugin-rss
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  // ...
  plugins: [
    rssPlugin({
      limit: 20,        // most recent posts
      language: 'en',   // BCP 47 language tag
      // siteUrl: 'https://example.com',
      // feedPath: '/feed.xml',
    }),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `limit` | `20` | Number of newest published posts to include |
| `language` | `'en'` | RSS `<language>` tag (BCP 47) |
| `siteUrl` | `site.url` | Override the base URL (e.g. for staging environments) |
| `feedPath` | `/feed.xml` | Path the feed is served at; emitted in the `<atom:link rel="self">` element |

The plugin also adds an autodiscovery `<link rel="alternate" type="application/rss+xml">` to your site's `<head>` via the `siteMetadata` hook.

## Trust level

`trusted` — runs in the trusted Lambda processor with read access to the post table and write access under `public/plugins/rss/` in the site's S3 bucket.

## Hooks

Subscribes to:

- `content.published`
- `content.unpublished`
- `content.deleted`
- `content.updated` (so a re-titled published post produces a fresh `<title>` in the feed)

Each hook re-reads the full set of published posts and writes the regenerated XML to `s3://<site-bucket>/public/plugins/rss/feed.xml`. The Next.js route reads from there, so the feed is always at most one event behind real time.
