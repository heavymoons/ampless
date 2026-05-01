# ampless

**Serverless CMS for AWS Amplify.** The "AWS-native EmDash."

> Pre-release, closed development until v1.0 RC. Shape is settling but APIs may still evolve.

## Why ampless

- **AWS-native.** Runs entirely on Amplify Gen 2 — Cognito for auth, DynamoDB for content, S3 for media, Lambda for plugins, AppSync for queries. No extra moving parts.
- **AI-first.** The MCP server (`@ampless/mcp-server`) lets Claude Desktop, Cursor, Claude Code and anything else that speaks MCP read and write your posts directly.
- **Plugin-friendly.** Trust-level-segregated Lambdas (`untrusted` / `trusted`) execute event hooks without giving every plugin access to your data.
- **TypeScript-first.** Everything from `cms.config.ts` to event handlers is typed end-to-end.

## Quick start

```bash
npx create-ampless@latest
```

The CLI scaffolds a Next.js 15 (App Router) project. Then:

```bash
cd <your-project>
npm install
npx ampx sandbox      # provisions AWS dev resources, generates amplify_outputs.json
npm run dev           # http://localhost:3000
```

Sign up at `/login` — the first registered user is automatically promoted to the `ampless-admin` Cognito group.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 App Router |
| UI | shadcn/ui + Tailwind v4 |
| Editor | tiptap (with image/link extensions) |
| Backend | AWS Amplify Gen 2 (CDK-based) |
| Auth | Cognito (User Pool + Identity Pool) |
| Data | DynamoDB |
| Media | S3 (public/private prefixes, presigned-URL or direct delivery) |
| API | AppSync GraphQL (custom JS resolvers for public reads) |
| Plugins | Lambda functions, trust-level segregated, fed by DynamoDB Streams → SQS |

## Packages

| Package | Purpose |
|---|---|
| [`ampless`](./packages/ampless) | Core types, plugin contract, shared utilities |
| [`create-ampless`](./packages/create-ampless) | `npx create-ampless@latest` — project scaffolding |
| [`@ampless/plugin-seo`](./packages/plugin-seo) | OGP / Twitter / canonical metadata + `sitemap.xml` |
| [`@ampless/plugin-rss`](./packages/plugin-rss) | RSS 2.0 `/feed.xml` |
| [`@ampless/plugin-webhook`](./packages/plugin-webhook) | POST events to external URLs (HMAC-signed) |
| [`@ampless/mcp-server`](./packages/mcp-server) | MCP server for Claude Desktop / Cursor / Claude Code |

## Plugins in `cms.config.ts`

```ts
import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'
import webhookPlugin from '@ampless/plugin-webhook'

export default defineConfig({
  site: { name: 'My Blog', url: 'https://example.com' },
  plugins: [
    seoPlugin({ twitterSite: '@example' }),
    rssPlugin({ language: 'en', limit: 20 }),
    webhookPlugin({
      endpoints: [{ url: 'https://example.com/hooks/ampless', secret: process.env.WEBHOOK_SECRET }],
    }),
  ],
})
```

## Editor trust model (read this before granting `editor` access)

ampless treats `ampless-editor` as a trusted principal — same shape as WordPress's `unfiltered_html` capability. Editors can store arbitrary HTML / JavaScript in post bodies and the public site renders it verbatim. The full spec is in [`docs/architecture/04-access-layer-mcp.md`](./docs/architecture/04-access-layer-mcp.md); the short version is **don't grant `editor` to anyone you wouldn't also grant `admin`**.

## Roadmap

ampless is being developed in the open eventually, but **the repo stays private until v1.0 RC**. Public release happens once it's good enough to run the maintainer's own multiple sites and the project's own marketing page is built with ampless itself.

| Phase | Highlights |
|---|---|
| v0.1 (done — internal) | CLI, admin panel, blog template, Cognito, MCP server, SEO/RSS/Webhook plugins |
| v0.x (in progress) | Multi-site, theme customization, MCP HTTP transport + access tokens, AI provider abstraction, WXR import, monitoring polish |
| v1.0 RC (public-flip trigger) | Core + first-party plugins are enough to run a real site; ampless's own marketing page exists |
| v1.0 stable | Admin polish, custom content types, REST API, eject |
| v2.0+ | Third-party plugins, marketplace, WASM sandbox |

Full list in [`docs/architecture/14-roadmap.md`](./docs/architecture/14-roadmap.md).

## Architecture

[`docs/architecture/`](./docs/architecture/) has the design docs split per concern. [`ARCHITECTURE.md`](./ARCHITECTURE.md) is the table of contents.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
