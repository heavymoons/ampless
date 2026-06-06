> 日本語版: [README.ja.md](./README.ja.md)
> 

# ampless

**Serverless CMS for AWS Amplify.** The "AWS-native EmDash."

> **Pre-release / alpha.** All packages publish under the `alpha` npm dist-tag. ampless is on a four-stage release path: **alpha** (closed, dogfood-only) → **beta** (repo goes public; npm `beta` dist-tag; breaking changes still possible) → **RC** (feature-complete, breaking changes no longer expected) → **stable** (v1.0). Today's stage is alpha; the source isn't browsable on GitHub yet, but npm packages are installable.

## Why ampless

- **AWS-native.** Runs entirely on Amplify Gen 2 — Cognito for auth, DynamoDB for content, S3 for media, Lambda for plugins, AppSync for queries. No extra moving parts.
- **AI-first.** The MCP server lets Claude, Cursor, Claude Code and anything else that speaks MCP read and write your posts via HTTP transport with Bearer token authentication issued from the admin UI.
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
| [`@ampless/mcp-server`](./packages/mcp-server) | MCP tool registry shared by the HTTP MCP transport (used by Claude Desktop, Cursor, Claude Code, and other MCP clients) |

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

## Authoring plugins

Want to ship your own plugin? The hands-on walkthrough lives in
[`packages/ampless/docs/plugin-author-guide.md`](./packages/ampless/docs/plugin-author-guide.md)
(also available in Japanese as `plugin-author-guide.ja.md`). The
same file ships inside the `ampless` npm tarball and is copied into
every scaffolded project at `docs/plugin-author-guide.md`, so
external authors can read it without checking out this repo.

It covers the Phase 1 + Phase 2 surfaces — descriptor-based head /
body injection, admin-managed `settings.public` values via
`ctx.setting<T>()`, async event hooks, the three trust levels, and
publishing to npm. The bundled GA4 / RSS / SEO / Webhook plugins are
the working examples it references.

The design rationale stays in
[`docs/architecture/08-plugin-architecture.md`](./docs/architecture/08-plugin-architecture.md);
the author guide focuses on what to write and where to put it.

## Editor trust model (read this before granting `editor` access)

ampless treats `ampless-editor` as a trusted principal — same shape as WordPress's `unfiltered_html` capability. Editors can store arbitrary HTML / JavaScript in post bodies and the public site renders it verbatim. The full spec is in [`docs/architecture/04-access-layer-mcp.md`](./docs/architecture/04-access-layer-mcp.md); the short version is **don't grant `editor` to anyone you wouldn't also grant `admin`**.

## Roadmap

ampless development follows a four-stage release path: **alpha → beta → RC → stable**. Today's stage is alpha — the repo is private, but npm packages publish under the `alpha` dist-tag. **Beta** is the public-flip moment (repo goes public, npm `beta` dist-tag, breaking changes still possible). **RC** is the feature-complete, no-more-breaking-changes phase. **v1.0 stable** ships simultaneously with the ampless introduction page (built with ampless itself).

| Phase | Highlights |
|---|---|
| v0.1 (done — internal) | CLI, admin panel, blog template, Cognito, MCP server, SEO/RSS/Webhook plugins |
| v0.x (in progress) | Theme customization, MCP HTTP transport + access tokens, CloudFront cache strategy, AI provider abstraction, WXR import, monitoring polish |
| **Beta (public release)** | Repo flips public, npm `beta` dist-tag, breaking changes still possible. External plugin authors can publish their plugins to npm (static `cms.config.ts` consumption); external users can install with full source visibility. |
| v1.0 RC | Feature-complete; breaking changes no longer expected. Dogfood sites run on RC builds. |
| v1.0 stable | Public launch — ampless introduction page (built with ampless) ships simultaneously. |
| v2.0+ | Runtime-loaded third-party plugins (admin-UI install, S3 + dynamic loading), plugin marketplace, WASM sandbox |

Full list in [`docs/architecture/14-roadmap.md`](./docs/architecture/14-roadmap.md).

## Architecture

[`docs/architecture/`](./docs/architecture/) has the design docs split per concern. [`ARCHITECTURE.md`](./ARCHITECTURE.md) is the table of contents.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
