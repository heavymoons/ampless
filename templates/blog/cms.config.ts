import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  site: {
    name: '{{siteName}}',
    url: 'http://localhost:3000',
  },
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
  ],
})
