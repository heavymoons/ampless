> 日本語版: [README.ja.md](./README.ja.md)
> 
# {{siteName}}

Your site is built with [ampless](https://github.com/heavymoons/ampless) — a serverless CMS that runs on AWS Amplify Gen 2 (Cognito + DynamoDB + S3 + AppSync + Lambda) with a Next.js 15 frontend.

This README covers what you, the site owner, need to know day-to-day. Operational recipes (rotating keys, restoring backups, etc.) live in [RUNBOOK.md](./RUNBOOK.md). Per-theme customization details live in `themes/<name>/README.md`.

If you use an AI coding agent (Claude Code, Cursor, Codex, etc.) on this project, point it at [AGENTS.md](./AGENTS.md) — that file tells the agent what it can and can't touch.

## Requirements

- **Node.js 20+** and **npm**
- **AWS account** with CLI credentials (`aws configure`) — the sandbox + production both deploy real AWS resources
- **GitHub account** for production hosting via AWS Amplify Hosting

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run sandbox` | Provision a personal AWS sandbox (Cognito / DynamoDB / S3 / etc.), regenerate `amplify_outputs.json`, then start `next dev` on `http://localhost:3000` |
| `npm run dev` | Start Next.js only (skip sandbox provisioning — use after `sandbox` has already run once) |
| `npm run build` | Production build of the Next.js app (also runs as part of Amplify Hosting deploy) |
| `npm run start` | Serve the production build locally |
| `npm run lint` | Lint with `next lint` |
| `npm run update-ampless` | Pull the latest ampless template files into this project, preserving your config and themes (see "Updating ampless" below) |
| `npm run copy-theme` | Add another official theme to this project after-the-fact |

## First time setup

```bash
npm install
npm run sandbox
```

First sandbox run takes 5–10 minutes (AWS resource provisioning). `amplify_outputs.json` is regenerated each time before `next dev` starts.

Open [http://localhost:3000/login](http://localhost:3000/login) and click **Create admin account**. The first registered user is automatically added to the `ampless-admin` Cognito group.

## Admin UI

After signing in, the admin lives at `/admin`:

| Path | Purpose |
| --- | --- |
| `/admin` | Dashboard |
| `/admin/posts` | List / create / edit posts (Tiptap editor, Markdown, raw HTML, or zip-uploaded static bundles) |
| `/admin/media` | Upload images / videos / files to S3 |
| `/admin/sites/<siteId>` | Site-level settings (name, URL) |
| `/admin/sites/<siteId>/theme` | Activate a theme + customize its fields (colors, fonts, nav, logo, etc.) |
| `/admin/users` | View users + Cognito group memberships |
| `/admin/mcp-tokens` | Issue Bearer tokens for the HTTP MCP endpoint |

User roles (Cognito groups):

- `ampless-admin` — full access (content + ops + destructive)
- `ampless-editor` — content CRUD (no destructive ops)
- `ampless-reader` — reserved for future REST/MCP API consumers

Promotion/demotion is done in the AWS Cognito console — see [RUNBOOK.md → Promote / demote a user](./RUNBOOK.md#promote--demote-a-user).

## Authoring content

Posts are the single content type. Each post has:

- **Format** — `tiptap` (rich text) / `markdown` / `html` (raw, no sanitization) / `static` (zip-upload of HTML/CSS/JS)
- **No layout** flag (`format: 'html'` only) — render the body verbatim with no Next.js layout and no theme chrome. URL stays `/<slug>`; the route redirects to `/_/<slug>`.
- **Slug** — the public URL
- **Status** — `draft` (admin only) or `published`

Full reference: [docs/CONTENT.md on GitHub](https://github.com/heavymoons/ampless/blob/main/docs/CONTENT.md) ([日本語](https://github.com/heavymoons/ampless/blob/main/docs/CONTENT.ja.md)).

## Themes

Every installed theme is bundled in this project under `themes/<name>/`. The **active** theme per site is a runtime setting — switching themes does **not** require a redeploy.

To switch the active theme: `/admin/sites/<siteId>/theme` → pick from the installed list → save.

To customize the active theme (colors, fonts, header / footer nav, etc.): same page — each theme exposes its own customization fields. See `themes/<name>/README.md` for what's customizable per theme.

To install another official theme into this project:

```bash
npm run copy-theme
```

To author your own theme: copy an existing one as a starting point (`cp -R themes/blog themes/your-theme`), edit `manifest.ts`, `tokens.css`, and `pages/*.tsx`, then add it to `themes-registry.ts`. Full guide: [docs/THEMES.md](https://github.com/heavymoons/ampless/blob/main/docs/THEMES.md) ([日本語](https://github.com/heavymoons/ampless/blob/main/docs/THEMES.ja.md)).

## Plugins

Plugins extend the CMS with event-driven side effects (SEO metadata, RSS feed, webhooks to external URLs, OG image generation, etc.). They're declared in [`cms.config.ts`](./cms.config.ts) and run on Lambda when posts are published / updated / deleted.

Bundled and ready to enable in `cms.config.ts`:

| Package | Purpose |
| --- | --- |
| `@ampless/plugin-seo` | Per-post OGP / Twitter / canonical metadata + `sitemap.xml` |
| `@ampless/plugin-rss` | RSS 2.0 feed at `/feed.xml` |
| `@ampless/plugin-webhook` | POST events to external URLs (HMAC-signed) |
| `@ampless/plugin-og-image` | Dynamic Open Graph image generation at `/og/<slug>` |

To add a plugin: install (`npm i @ampless/plugin-...`), import in `cms.config.ts`, and add to the `plugins` array:

```ts
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  // ...
  plugins: [
    seoPlugin({ twitterSite: '@example' }),
    rssPlugin({ language: 'en', limit: 20 }),
  ],
})
```

A redeploy is required for plugin changes (the plugin code ships in the Lambda bundle).

## Deploying to production

The shipped [`amplify.yml`](./amplify.yml) runs `npx ampx pipeline-deploy` (Amplify backend) + `npm run build` (Next.js) on every push to the branch you connect.

1. **Push this project to GitHub** (or another git host Amplify Hosting supports):
   ```bash
   git init && git add . && git commit -m "init"
   git remote add origin <your-repo>
   git push -u origin main
   ```
2. **AWS Amplify Hosting console** → **Create new app** → **Host web app** → connect the repo → pick the branch → review the auto-detected build settings (they should match `amplify.yml`) → deploy.
3. First deploy takes 10–20 minutes. Subsequent pushes to the connected branch redeploy automatically.

### Environment variables

Set per-environment values in **Amplify Hosting console → Hosting → Environment variables**. Common ones:

| Variable | Used by |
| --- | --- |
| `WEBHOOK_SECRET` | `@ampless/plugin-webhook` HMAC signing |

Trigger a redeploy after adding/changing env vars.

### Custom domains

Bind a domain to your Amplify Hosting app in **Domain management** — Amplify provisions an ACM certificate and DNS records automatically. Full step-by-step: [RUNBOOK.md → Adding a custom domain](./RUNBOOK.md#adding-a-custom-domain-to-amplify-hosting).

## AI integration (MCP)

ampless ships an MCP (Model Context Protocol) server so Claude Desktop / Cursor / Claude Code / anything that speaks MCP can read and write your posts.

- **Local / sandbox** — install once globally: `npx -y @ampless/mcp-server@alpha` with the path to your `amplify_outputs.json`.

## Updating ampless

ampless releases on the `alpha` dist-tag. To pick up new features:

```bash
npm run update-ampless
```

This runs `npx create-ampless@latest upgrade`, which:

- Bumps the `@ampless/*` and `ampless` dependencies in `package.json`
- Re-syncs the shared template files (admin app shell, amplify backend, lib/, middleware, themes) — your customizations to `cms.config.ts`, `theme.*` admin settings, posts, and theme manifest values are preserved.
- Updates `update-ampless` and `copy-theme` script entries if their commands change

You can review the diff before committing.

## Operations

Day-to-day operational recipes — user promotion, password reset, backup restore, custom domain wiring, AppSync API key rotation — live in [RUNBOOK.md](./RUNBOOK.md).

## License

This project's own code is yours. ampless itself is MIT-licensed; see the [ampless repository](https://github.com/heavymoons/ampless) for details.
