> 日本語版: [README.ja.md](./README.ja.md)
> 

# @ampless/plugin-og-image

Dynamic Open Graph image generation for [ampless](https://github.com/heavymoons/ampless). SNS crawlers hit `https://<your-site>/og/<slug>`, the Next.js route renders a JSX card containing the post title + excerpt + site name + an optional image (theme banner or the first image in the post body), and Next.js `ImageResponse` returns a PNG. WebP / AVIF source images are decoded to PNG on the fly via [@jsquash](https://github.com/jamsinclair/jSquash) so Satori can paint them.

> **Pre-release / beta.** Breaking changes possible in any minor version until v1.0.

## Install

```bash
npm install @ampless/plugin-og-image@beta
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import ogImagePlugin, { loadFontFromUrl } from '@ampless/plugin-og-image'

export default defineConfig({
  // ...
  plugins: [
    ogImagePlugin({
      // Required: at least one font. Satori cannot render without one.
      fonts: [
        {
          name: 'Inter',
          // Lazy loader — runs once per route invocation, then cached
          // in-process. Ship the .ttf / .otf from your CDN or public/.
          data: loadFontFromUrl('https://example.com/fonts/Inter-Regular.ttf'),
          weight: 400,
        },
      ],
      // Image strategy: 'content' (first image in post body) | 'theme'
      // (use `themeImageUrl`) | 'none' | (post) => url | null
      image: 'content',
      // Used when image === 'theme'
      // themeImageUrl: 'https://example.com/og-banner.png',
    }),
  ],
})
```

Add the dispatcher route in your Next.js app (the `_shared` template ships one at `app/og/[slug]/route.ts`).

## Options

| Option | Default | Notes |
|---|---|---|
| `fonts` | required | At least one font must be provided |
| `size` | `{ width: 1200, height: 630 }` | OG card dimensions |
| `image` | `'content'` | `'theme'` / `'content'` / `'none'` / `(post) => url \| null` |
| `themeImageUrl` | none | Used when `image === 'theme'` |
| `render` | built-in card | Override to fully customize the JSX |

## What it produces

- A `metadata()` hook that injects `openGraph.images: [{ url: '<site>/og/<slug>', width, height }]` into per-post metadata, so SNS crawlers know where to fetch the card.
- An `ogImage.render(ctx)` that the dispatcher route turns into a PNG via `next/og`.

## Trust level

`untrusted` — runs only in the Next.js request path (no Lambda hooks). No AWS credentials are touched; fonts and post images are fetched over plain HTTPS.

## License

[MIT](../../LICENSE)
