import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'
// import schemaJsonLdPlugin from '@ampless/plugin-schema-jsonld'
// import readingTimePlugin from '@ampless/plugin-reading-time'
// import aiActionsPlugin from '@ampless/plugin-ai-actions'
// import cookieConsentPlugin from '@ampless/plugin-cookie-consent'
// import analyticsGa4Plugin from '@ampless/plugin-analytics-ga4'
// import gtmPlugin from '@ampless/plugin-gtm'
// import plausiblePlugin from '@ampless/plugin-plausible'
// import webhookPlugin from '@ampless/plugin-webhook'
// import ogImagePlugin, { loadFontFromUrl } from '@ampless/plugin-og-image'

export default defineConfig({
  site: {
    name: '{{siteName}}',
    url: 'http://localhost:3000',
    // description: 'One-line description of this site (used by SEO and /llms.txt).',
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
  // Date display format.
  // 'iso'    — YYYY-MM-DD (default; SSR-safe, locale-neutral)
  // 'long'   — "April 27, 2026" (en-US)
  // 'locale' — browser/server locale
  dateFormat: 'iso',
  // IANA timezone used for date rendering. Pin this so SSR and CSR
  // always produce the same string. Examples: 'Asia/Tokyo', 'America/New_York'.
  timezone: 'UTC',
  // Post revision history. Every post save is snapshotted into the
  // PostHistory table by the event-dispatcher Lambda.
  // history: { retentionDays: 0 }, // 0 = keep every revision forever; e.g. 365 to expire after a year
  // AI-readable publishing. `/<slug>.md` serves a markdown projection of
  // each published post and `/llms.txt` serves a site-wide AI index
  // (both default: enabled). `publicMcp` (default: false) exposes an
  // anonymous, read-only MCP endpoint at `/api/mcp` — published posts
  // only, never writes. Because it is unauthenticated it is opt-in, and
  // its built-in circuit breaker is a coarse warm-instance guard, not a
  // per-IP rate limiter: pair `publicMcp: true` with CloudFront / WAF for
  // real abuse protection.
  // `mcpDiscovery` (default: false, experimental) additionally publishes
  // discovery metadata so AI clients can find the endpoint on their own:
  // a catalog at `/.well-known/mcp/catalog.json` and a Server Card at
  // `/api/mcp/server-card`. Requires `publicMcp: true` + an http(s)
  // `site.url`. See https://github.com/heavymoons/ampless/wiki/mcp.
  // ai: { markdownRoutes: false, llmsTxt: { limit: 100 }, publicMcp: true, mcpDiscovery: true },
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
    // Cookie consent banner. Installs `window.amplessConsent` so other
    // plugins can gate themselves on user consent (see the Consent
    // Convention in `https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture`).
    //
    // IMPORTANT: cookieConsentPlugin() must come BEFORE any analytics
    // plugin in this array — both run `afterInteractive` and the consent
    // API must be installed before analytics scripts read it. (Analytics
    // plugins also wait for `ampless:consent-ready`, so out-of-order
    // registration still works, but in-order is faster.)
    //
    // Categories (analytics / marketing / etc.) are managed live from
    // `/admin/plugins`. Banner text and button labels are also admin-editable.
    //
    // cookieConsentPlugin(),
    //
    // Reading-time badge. Estimates read time from the post body and injects
    // a configurable label (default: "3 min read") before or after the post
    // content. Supports English word count + CJK character count (÷ 2).
    // Label template and position are editable from `/admin/plugins`.
    //
    // readingTimePlugin(),
    //
    // AI actions: adds a "View as Markdown" link (default on) after the
    // post content, plus opt-in "Open in Claude" / "Open in ChatGPT"
    // links. REQUIRES `ai.markdownRoutes` to stay enabled (the default
    // above) — every link this plugin renders points at the post's
    // /<slug>.md route. Do not register this plugin if you set
    // `ai: { markdownRoutes: false }`. See packages/ampless/docs/plugin-author-guide.md
    // and the package README for why the external links default OFF
    // (unofficial URL prefill convention) and why there's no "Copy
    // Markdown" button (no inline-script capability yet).
    //
    // aiActionsPlugin({
    //   showClaude: false, // opt-in — verify the ?q= prefill on your site first
    //   showChatgpt: false, // opt-in — same caveat
    // }),
    //
    // Google Analytics 4. Once registered here, the measurement ID can be
    // edited from `/admin/plugins` without a redeploy — the constructor
    // value below is just the initial default. Pass an empty string to
    // disable the GA tag entirely. See packages/ampless/docs/plugin-author-guide.md.
    //
    // analyticsGa4Plugin({
    //   measurementId: '', // 'G-XXXXXXXX' to enable
    // }),
    //
    // Google Tag Manager. Like GA4, the container ID is editable from
    // `/admin/plugins` after deploy. Tags fire via GTM's own trigger model.
    //
    // gtmPlugin({
    //   containerId: '', // 'GTM-XXXXXXX' to enable
    // }),
    //
    // Plausible Analytics (privacy-focused, typically no cookie consent
    // required). `domain` matches the registered Plausible site.
    // `scriptUrl` defaults to plausible.io; override for self-hosted.
    //
    // plausiblePlugin({
    //   domain: '', // 'example.com' to enable
    // }),
    //
    // JSON-LD structured data (Schema.org). Injects <script type="application/ld+json">
    // into post pages for Article / BlogPosting markup. articleType, authorName and
    // publisherName fall back to the site name when left empty.
    //
    // schemaJsonLdPlugin({
    //   articleType: 'Article', // 'Article' | 'BlogPosting' | 'NewsArticle'
    //   authorName: '', // empty falls back to site.name
    //   publisherName: '', // empty falls back to site.name
    //   publisherLogo: '', // optional absolute URL to publisher logo
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
