---
"create-ampless": patch
"ampless": patch
---

`create-ampless --deploy --domain <X>` now rewrites the scaffolded
`cms.config.ts` so `site.url` reflects the deployed domain from the
very first build. `site.url` is rewritten from `'http://localhost:3000'`
to `'https://<fullDomain>'`. The rewrite is idempotent and only fires
when the scaffold placeholder is still in place, so `--mount` mode
against a project where the user already customized `cms.config.ts` is
a no-op.

Also: `create-ampless` now writes a canonical `.gitignore` into every
scaffolded project (`node_modules/`, `.next/`, `next-env.d.ts`,
`.amplify/`, `amplify_outputs.json`, `*.tsbuildinfo`, `.env*`,
`.DS_Store`, editor dirs, log files). The constant is shared between
scaffold and `--mount` so they can't drift.
