---
"create-ampless": patch
"ampless": patch
---

`create-ampless --deploy --domain <X>` now rewrites the scaffolded
`cms.config.ts` so the admin sites list reflects the deployed domain
from the very first build, instead of carrying the local-dev defaults
into production:

- `site.url` is rewritten from `'http://localhost:3000'` to
  `'https://<fullDomain>'`.
- A `sites: { default: { domains: ['<fullDomain>'] } }` block is
  injected so the domain shows up in the admin sites list.

Both rewrites are idempotent and only fire when the scaffold
placeholders are still in place, so `--mount` mode against a project
where the user already customized `cms.config.ts` is a no-op.

To support the seeded single-entry `sites:` block without breaking
local development (where `localhost` is not a registered domain),
`ampless.resolveSiteId` now treats a single declared site as a
catch-all for any host — matching what `isMultiSite` already considered
"single-site mode". Multi-site behavior (strict host → site lookup, 404
on unknown host) is unchanged for configurations with 2+ sites.

Also: `create-ampless` now writes a canonical `.gitignore` into every
scaffolded project (`node_modules/`, `.next/`, `next-env.d.ts`,
`.amplify/`, `amplify_outputs.json`, `*.tsbuildinfo`, `.env*`,
`.DS_Store`, editor dirs, log files). Previously the scaffold shipped
no `.gitignore` at all, leaving fresh projects vulnerable to committing
`node_modules` or leaking `amplify_outputs.json` (which contains live
Cognito identity pool ids). The constant is now shared between scaffold
and `--mount` so they can't drift; `MOUNT_DEFAULT_GITIGNORE` continues
to re-export the same value for backward compatibility.
