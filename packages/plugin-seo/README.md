# @ampless/plugin-seo

SEO plugin for ampless — automatically generates meta tags, Open Graph, and sitemaps.

> ⚠️ **Early development** — API is unstable.

## Installation

```bash
npm install @ampless/plugin-seo
```

## Usage

```ts
import { defineConfig } from 'ampless'
import seo from '@ampless/plugin-seo'

export default defineConfig({
  plugins: [
    seo({
      sitemap: true,
      openGraph: true,
      twitterCard: 'summary_large_image',
    }),
  ],
})
```

## Features

- Meta title / description auto-generation
- Open Graph tags
- Twitter Card tags
- XML sitemap (`/sitemap.xml`)

## License

[MIT](../../LICENSE)
