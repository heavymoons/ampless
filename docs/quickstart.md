> 日本語版: [quickstart.ja.md](./quickstart.ja.md)
>
# Quick start

## Prerequisites

- Node.js 22.13 or newer (pnpm 11 prerequisite)
- A package manager — npm ships with Node and works out of the box; ampless itself is built with pnpm but scaffolded projects can use either
- AWS CLI authenticated to the account you want sandbox resources in — `aws configure` (or any other credential provider AWS CLI honours)
- Optional but recommended: GitHub CLI authenticated (`gh auth login`) for the production deploy path

ampless runs entirely on AWS Amplify Gen 2 — no external services, no separate database to manage.

## Scaffold and run

1. **Scaffold the project**:
   ```bash
   npx create-ampless@beta my-site
   ```
   Creates a Next.js 16 (App Router) project named `my-site` with the Amplify Gen 2 backend wired up. The full CLI flag set is documented in `npx create-ampless@beta --help`.

2. **Install dependencies**:
   ```bash
   cd my-site
   npm install
   ```

3. **Boot the sandbox** (single command — the scaffolded `package.json` ships a `sandbox` script that chains `ampx sandbox --once` and `next dev`):
   ```bash
   npm run sandbox       # provisions AWS resources (10–20 min on first run), then starts http://localhost:3000
   ```
   The `--once` flag exits the sandbox after a single deploy so the Next.js dev server can start; for continuous deploys during heavy backend work, run `npx ampx sandbox` (watch mode) in a separate terminal and `npm run dev` in another.

> Use the `@beta` tag while ampless is in beta — `@latest` is reserved for the eventual v1.0 release. See [the release strategy](./architecture/14-roadmap.md) for the four-stage path.

## First admin user

Visit `http://localhost:3000/login` and sign up. The first registered user is automatically promoted to the `ampless-admin` Cognito group — there is no separate bootstrap or invitation flow. **Subsequent signups land in no Cognito group by default** and have no access until an admin promotes them via the admin UI or the AWS Cognito console.

⚠️ ampless treats `ampless-editor` as a trusted principal (editors can store HTML / JS in post bodies). Before promoting anyone to `ampless-editor`, see the "Editor trust model" section in the [README](../README.md).

## What just got provisioned

`npx ampx sandbox` walks CloudFormation through the Amplify Gen 2 stack defined in `amplify/backend.ts`:

- **Cognito** — User Pool + Identity Pool, with `ampless-admin` / `ampless-editor` groups
- **DynamoDB** — `Post`, `Page`, `Media`, `Taxonomy`, `PostTag`, `KvStore`, `PluginSecret`, `PluginSecretIndicator`, `McpToken` tables
- **S3** — content bucket with `public/`, `public/media/`, `public/plugins/<instanceId>/` prefixes
- **AppSync** — GraphQL API with custom JS resolvers for public reads
- **Lambda** — event processor functions for the trust-level plugin sandbox

Everything is provisioned in your own AWS account, charged to your own bill. The sandbox is destroyed cleanly with `npx ampx sandbox delete` when you're done experimenting.

## What's next

- **Write a post** — log in to `/admin/posts/new`. The editor uses tiptap by default and supports markdown / HTML / static formats too
- **Install a first-party plugin** — add `seoPlugin()` / `rssPlugin()` / `webhookPlugin()` to `cms.config.ts`; see the [plugin author guide](../packages/ampless/docs/plugin-author-guide.md) for what each capability does
- **Deploy to production** — see the Publishing section in the [README](../README.md) when you're ready to push the sandbox project to Amplify Hosting with a custom domain
- **Operations** — the scaffolded project ships with a `RUNBOOK.md` covering user promotion, password reset, backup / restore, and failed-event inspection

## Where to go next

- [Architecture overview](./architecture/) — design decisions for the Amplify Gen 2 stack, the plugin sandbox, the MCP HTTP transport
- [Plugin author guide](../packages/ampless/docs/plugin-author-guide.md) — write your own plugin
- [Themes guide](./THEMES.md) — customize the look or pick a different starter theme
- [CONTENT.md](./CONTENT.md) — the post / page / media data model
