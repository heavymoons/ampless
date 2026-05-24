> 日本語版: [README.ja.md](./README.ja.md)
> 

# create-ampless

CLI scaffolding tool for [ampless](https://github.com/heavymoons/ampless) projects.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0. Use the `@alpha` tag (the `@latest` tag won't exist until v1.0).

```bash
npx create-ampless@alpha
```

The wizard walks you through:

1. Project name
2. Site name (used as the default `<title>` and OGP `siteName`)
3. Theme — pick from the bundled themes (e.g. `blog`)
4. Plugins — `seo`, `rss`, `webhook`

Output is a Next.js 16 (App Router) project with the AWS Amplify Gen 2 backend definitions, an admin panel at `/admin`, public blog at `/`, the chosen plugins pre-wired in `cms.config.ts`, and a `RUNBOOK.md` for operations notes.

## Next steps inside the generated project

```bash
cd my-project
npm install
npx ampx sandbox        # provision AWS dev resources, generates amplify_outputs.json
npm run dev             # http://localhost:3000
```

Sign up at `/login` — the first registered user is automatically promoted to the `ampless-admin` Cognito group.

## One-shot deploy: `--deploy`

The wizard can also take you all the way from `npx` to a live Amplify Hosting URL:

```bash
npx create-ampless@alpha my-site --deploy
```

That extra flag, after scaffolding, runs:

1. `git init` + initial commit
2. Create a GitHub repo (`gh repo create`) and push
3. `aws amplify create-app` linked to the new repo
4. `aws amplify create-branch main`
5. `aws amplify start-job --job-type RELEASE`
6. Optional `aws amplify create-domain-association` if you pass `--domain`

Anything missing on the command line gets asked interactively. For CI-friendly fully-flagged usage:

```bash
npx create-ampless@alpha my-site --deploy \
  --github-owner my-org \
  --github-private \
  --aws-region us-east-1 \
  --domain example.com --subdomain blog \
  --skip-confirm
```

If the apex domain is hosted in Route 53 in the same AWS account, Amplify will auto-create the DNS records once ACM validates. Otherwise the CLI prints the exact CNAMEs to add at your registrar.

### Deploy requirements

- [`gh`](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [`aws`](https://aws.amazon.com/cli/) installed and configured (`aws configure`)
- A GitHub token with `repo` scope (resolved via `--github-token` → `GITHUB_TOKEN` env → `gh auth token` → interactive prompt)

## Requirements

- Node.js >= 20
- AWS account + `aws configure` already set up (sandbox / pipeline-deploy talk to AWS directly)

## License

[MIT](../../LICENSE)
