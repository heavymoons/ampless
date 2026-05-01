# create-ampless

CLI scaffolding tool for [ampless](https://github.com/heavymoons/ampless) projects.

```bash
npx create-ampless@latest
```

The wizard walks you through:

1. Project name
2. Site name (used as the default `<title>` and OGP `siteName`)
3. Theme — `blog` for v0.1
4. Plugins — `seo`, `rss`, `webhook`

Output is a Next.js 15 (App Router) project with the AWS Amplify Gen 2 backend definitions, an admin panel at `/admin`, public blog at `/`, the chosen plugins pre-wired in `cms.config.ts`, and a `RUNBOOK.md` for operations notes.

## Next steps inside the generated project

```bash
cd my-project
npm install
npx ampx sandbox        # provision AWS dev resources, generates amplify_outputs.json
npm run dev             # http://localhost:3000
```

Sign up at `/login` — the first registered user is automatically promoted to the `ampless-admin` Cognito group.

## Requirements

- Node.js >= 20
- AWS account + `aws configure` already set up (sandbox / pipeline-deploy talk to AWS directly)

## License

[MIT](../../LICENSE)
