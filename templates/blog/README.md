# {{siteName}}

A blog site powered by [ampless](https://github.com/heavymoons/ampless).

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the homepage shows built-in dummy posts until you connect a backend.

## Deploy to AWS

```bash
npx ampx sandbox   # personal sandbox (requires AWS credentials)
```

Then push to git and connect the repository to Amplify Hosting.

## Customize

- `cms.config.ts` — site name, media delivery mode, plugins
- `app/` — Next.js App Router pages
- `amplify/` — Amplify Gen 2 backend definitions

## Plugins

Enabled: {{plugins}}
