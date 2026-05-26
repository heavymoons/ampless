> 日本語版: [12-setup-experience.ja.md](./12-setup-experience.ja.md)
> 
## 12. Setup Experience

### Scaffolding a new project

`create-ampless` is the entry point. The interactive wizard asks four questions and writes a self-contained project tree.

```bash
$ npx create-ampless@latest my-blog

create-ampless
│
◇ Project name … my-blog
◇ Site display name … My Blog
◇ Themes to install (space to toggle) … blog, minimal, landing, corporate, docs, dads
◇ Plugins (space to toggle) … seo
◇ Create project "my-blog"? … Yes

✔ Project scaffolded

Next steps:
  cd my-blog
  npx ampx sandbox       # spin up a personal Amplify dev backend
  pnpm dev               # run the Next.js app
```

What the wizard collects (see [`packages/create-ampless/src/prompts.ts`](../../packages/create-ampless/src/prompts.ts)):

| Prompt | Choices |
|---|---|
| Project name | a-z, 0-9, `-`, `_` |
| Site display name | free text |
| Themes (multi-select) | `blog` / `minimal` / `landing` / `corporate` / `docs` / `dads` — first selected becomes the default `theme.active` |
| Plugins (multi-select) | `seo` / `rss` / `webhook` |

There is no auth-method prompt — every project ships with the standard Cognito email + password setup. There is no plugin choice beyond the three listed (no contact form, no analytics). Adding more plugins is `pnpm add @ampless/plugin-...` after scaffolding.

### Non-interactive scaffolding

All wizard prompts have flag equivalents for CI / automation:

```bash
npx create-ampless@latest my-blog \
  --site-name "My Blog" \
  --themes blog,docs \
  --plugins seo,rss \
  --skip-confirm
```

### Local development

```bash
cd my-blog
npx ampx sandbox       # provisions a personal Amplify backend in your AWS account
pnpm dev               # starts Next.js
```

The Amplify sandbox spins up Cognito + AppSync + DynamoDB + S3 in your AWS account under a per-user stack. It tears them down on `Ctrl+C` (or persists across runs with `--once`). Sandbox stacks are best treated as ephemeral: schema changes occasionally rebuild the API and reset the tables ([memory entry](#)).

### Production deployment

There are two paths.

#### Path A: `--deploy` from scratch

`create-ampless --deploy` scaffolds the project, then creates a GitHub repo, an Amplify Hosting app, connects them, and kicks off the first deployment in one go.

```bash
npx create-ampless@latest my-blog --deploy \
  --github-owner my-org \
  --aws-region us-east-1 \
  --create-iam-role
```

Optional flags cover custom domain attach (`--domain`, `--subdomain`), reuse of an existing Amplify Hosting service role (`--iam-service-role`), and private GitHub repos (`--github-private`).

#### Path B: `--mount` an existing project

If you've scaffolded locally and tested with `npx ampx sandbox`, `--mount` skips scaffolding and just connects the current directory to a new GitHub repo + Amplify Hosting app:

```bash
cd my-blog
npx create-ampless@latest --mount \
  --github-owner my-org \
  --aws-region us-east-1
```

Mount mode is the practical path for "I want to play with it locally first, then publish".

### Upgrading

After ampless package versions move, refresh the template-owned files (admin routes, internal shells) with:

```bash
cd my-blog
npx create-ampless@latest upgrade        # or: --upgrade
```

The upgrade command syncs `AMPLESS_MANAGED_APP_PATHS` (admin routes, internal route shells) and deletes any retired files listed in `AMPLESS_RETIRED_PATHS`. User-owned files outside those paths (themes, `cms.config.ts`, `app/page.tsx`, etc.) are never touched. `--dry-run` shows what would change without writing.

### Theme customization workflow

The shipped themes (`blog`, `corporate`, …) are *managed* — `--upgrade` rewrites them when the template changes. To customise a theme without losing your edits on upgrade, copy it to a `my-`-prefixed directory:

```bash
npx create-ampless@latest copy-theme blog my-blog
```

Files in `themes/my-blog/` are user-owned; upgrades leave them alone. The full workflow is documented in the project's `THEMES.md`.

### Distribution Methods

1. **`npx create-ampless@latest`** (primary): interactive scaffold + optional one-shot deploy.
2. **`--mount`**: take a project you've already scaffolded and connect it to GitHub + Amplify Hosting.
3. **CDK construct path**: add `@ampless/backend` to an existing Amplify Gen 2 project by importing `defineAmplessBackend`, `amplessSchemaModels`, `amplessAuthConfig`, etc. directly into the project's `amplify/backend.ts`. This is the unsupported escape hatch for sites that don't fit the template tree.

### Comparison with EmDash

| Step | EmDash (Cloudflare) | ampless (Amplify) |
|------|--------------------|-------------------|
| Initialize | `npm create emdash@latest` | `npx create-ampless@latest` |
| Local backend | `npx wrangler dev` | `npx ampx sandbox` |
| Local frontend | (same process) | `pnpm dev` |
| Production deploy | `npx wrangler deploy` | `--deploy` / `--mount` (auto), or manually connect GitHub in the Amplify console |
| Account required | Cloudflare (free tier) | AWS (free tier available) |
| Biggest hurdle | wrangler configuration | AWS account + initial IAM setup |

---
