> 日本語版: [README.ja.md](./README.ja.md)
> 

# ampless

**Serverless CMS for AWS Amplify.** The "AWS-native EmDash."

> **Pre-release / alpha.** All packages publish under the `alpha` npm dist-tag (`0.x-alpha.y` semver). Breaking changes are possible in any minor version until v1.0 RC. The repo stays private until v1.0 RC — npm packages remain installable, but the source isn't browsable on GitHub yet.

## Why ampless

- **AWS-native.** Runs entirely on Amplify Gen 2 — Cognito for auth, DynamoDB for content, S3 for media, Lambda for plugins, AppSync for queries. No extra moving parts.
- **AI-first.** The MCP server (`@ampless/mcp-server`) lets Claude Desktop, Cursor, Claude Code and anything else that speaks MCP read and write your posts directly.
- **Plugin-friendly.** Trust-level-segregated Lambdas (`untrusted` / `trusted`) execute event hooks without giving every plugin access to your data.
- **TypeScript-first.** Everything from `cms.config.ts` to event handlers is typed end-to-end.

## Quick start

```bash
npx create-ampless@alpha my-site
```

The CLI scaffolds a Next.js 16 (App Router) project. Then:

```bash
cd my-site
npm install
npx ampx sandbox      # provisions AWS dev resources, generates amplify_outputs.json
npm run dev           # http://localhost:3000
```

> Use the `@alpha` tag — `@latest` is reserved for the eventual v1.0 release.

Sign up at `/login` — the first registered user is automatically promoted to the `ampless-admin` Cognito group.

When you're ready to publish, the CLI's `--mount` mode wires the directory you've been working in to a new GitHub repo + Amplify Hosting app in one shot — see [Publishing](#publishing) below.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 App Router |
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

## Publishing

After you've scaffolded locally and confirmed the sandbox is happy, push the project to GitHub and connect it to Amplify Hosting. Two paths:

**CLI (`--mount`, recommended).** From inside the project directory:

```bash
npx create-ampless@latest --mount \
  --github-owner <your-user-or-org> \
  --aws-region <region> \
  --create-iam-role           # one-off; reuse `--iam-service-role <arn>` next time
```

The CLI creates the GitHub repo (`gh` CLI auth or `GITHUB_TOKEN` required), creates the Amplify Hosting app, registers the GitHub connection, sets `amplify.yml` build settings, and kicks off the first deploy. Add `--domain` / `--subdomain` to bind a custom domain in the same pass; add `--skip-confirm` to make it CI-friendly. See `npx create-ampless@latest --help` for the full flag list.

**Manual (console).** `git init && git push` to a repo of your own, then **AWS Amplify Hosting console → Create new app → Host web app → connect repo → deploy**. Step-by-step in the scaffolded project's `README.md` ("Deploying to production") and `RUNBOOK.md`.

Either way the first deploy takes 10–20 minutes (CloudFormation provisions Cognito, DynamoDB, S3, AppSync, Lambda). Subsequent pushes redeploy automatically via the connected branch.

Prerequisites for the CLI flow: [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (`aws configure`) and [GitHub CLI](https://cli.github.com/) (`gh auth login`) authenticated, or supply `--github-token` directly. Full details land in the scaffolded project's `README.md` ("Requirements" + "Deploying to production").

## Editor trust model (read this before granting `editor` access)

ampless treats `ampless-editor` as a trusted principal — same shape as WordPress's `unfiltered_html` capability. Editors can store arbitrary HTML / JavaScript in post bodies and the public site renders it verbatim. The full spec is in [`docs/architecture/04-access-layer-mcp.md`](./docs/architecture/04-access-layer-mcp.md); the short version is **don't grant `editor` to anyone you wouldn't also grant `admin`**.

## Roadmap

ampless is being developed in the open eventually, but **the repo stays private until v1.0 RC**. Public release happens once it's good enough to run the maintainer's own multiple sites and the project's own marketing page is built with ampless itself.

| Phase | Highlights |
|---|---|
| v0.1 (done — internal) | CLI, admin panel, blog template, Cognito, MCP server, SEO/RSS/Webhook plugins |
| v0.x (in progress) | Theme customization, MCP HTTP transport + access tokens, CloudFront cache strategy, AI provider abstraction, WXR import, monitoring polish |
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
