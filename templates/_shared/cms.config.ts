import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'
// import webhookPlugin from '@ampless/plugin-webhook'
// import ogImagePlugin, { loadFontFromUrl } from '@ampless/plugin-og-image'

export default defineConfig({
  site: {
    name: '{{siteName}}',
    url: 'http://localhost:3000',
  },
  // Admin UI language. Built-in dictionaries: 'ja', 'en'. Add more by
  // dropping `locales/<code>.json` and registering it in `lib/i18n.ts`.
  locale: 'ja',
  media: {
    delivery: 'nextjs',
    // 'inline'   — images flow inline at imageMaxWidth (default)
    // 'lightbox' — click an image to enlarge in a fullscreen overlay
    imageDisplay: 'inline',
    imageMaxWidth: '100%',
    // Defaults for the upload-time image processing UI.
    // Per-upload values override these in the dialog.
    processing: {
      maxDimension: 2400,
      format: 'webp',
      quality: 0.85,
      losslessForPng: true,
    },
  },
  // Multi-site config. Leave undefined for single-site operation; the
  // runtime then serves every request as siteId='default'. To run
  // multiple sites in one Amplify environment, declare two or more
  // entries here:
  //
  //   sites: {
  //     blog: {
  //       domains: ['blog.example.com', 'www.example.com'],
  //       name: 'My Blog',
  //       url: 'https://blog.example.com',
  //     },
  //     docs: {
  //       domains: ['docs.example.com'],
  //       name: 'Docs',
  //       url: 'https://docs.example.com',
  //     },
  //   },
  //
  // In multi-site mode the middleware forces `Cache-Control: private,
  // no-store` on public responses (Amplify Hosting's CloudFront cache
  // key cannot disambiguate by Host). Single-site mode leaves caching
  // to the default page directives.

  // 'iso'    — YYYY-MM-DD (default; SSR-safe, locale-neutral)
  // 'long'   — "April 27, 2026" (en-US)
  // 'locale' — browser/server locale
  dateFormat: 'iso',
  // IANA timezone used for date rendering. Pin this so SSR and CSR
  // always produce the same string. Examples: 'Asia/Tokyo', 'America/New_York'.
  timezone: 'UTC',
  // Active plugins. Order doesn't matter; the runtime aggregates metadata
  // and runs hooks for events each plugin subscribes to.
  //
  // Plugin authors:
  //  - Plugin factories must return a plain `AmplessPlugin` object. Do NOT
  //    perform side effects at module top level (network calls, FS writes,
  //    global state) — both trusted and untrusted Lambdas import this file,
  //    so module-level work runs in every trust context regardless of which
  //    Lambda actually invokes the plugin's hooks.
  //  - Hooks must be idempotent. SQS guarantees at-least-once delivery and
  //    the dispatcher fans out to both queues; a single source MODIFY can
  //    trigger your hook more than once.
  //  - Use `ctx.writePublicAsset(key, ...)` for any S3 write — the runtime
  //    automatically namespaces under `public/plugins/{your-plugin-name}/`.
  plugins: [
    seoPlugin({
      // defaultOgImage: '/og.png',
      // twitterSite: '@example',
    }),
    rssPlugin({
      limit: 20,
      // language: 'ja',
    }),
    // webhookPlugin({
    //   endpoints: [
    //     {
    //       url: 'https://example.com/webhook',
    //       secret: process.env.WEBHOOK_SECRET,
    //       events: ['content.published', 'content.unpublished', 'content.deleted'],
    //     },
    //   ],
    // }),
    //
    // Per-post OG images: SNS crawlers hit `/og/<slug>` and we render
    // a JSX card → PNG via Next.js `ImageResponse`. Requires at least one
    // font — ship a .ttf from your CDN or `/public` directory.
    //
    // ogImagePlugin({
    //   fonts: [
    //     {
    //       name: 'Inter',
    //       data: loadFontFromUrl('https://example.com/fonts/Inter-Regular.ttf'),
    //       weight: 400,
    //     },
    //   ],
    //   // 'content' picks the first image in the post body. Use 'theme'
    //   // + themeImageUrl for a fixed banner, or 'none' for text-only.
    //   image: 'content',
    // }),
  ],
})
