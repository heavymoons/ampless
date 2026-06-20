---
"create-ampless": patch
---

Set `skipTrailingSlashRedirect: true` in the scaffolded `next.config.mjs`. Static-bundle posts (`format: 'static'`) are served at `/<slug>/` and the static route 308-redirects `/<slug>` → `/<slug>/`; Next.js's default trailing-slash normalization redirects the other way, producing an infinite `/<slug>` ⇄ `/<slug>/` loop. Disabling Next's normalization lets the static route own trailing-slash handling.

`next.config.mjs` is a managed (replace) file, so existing sites pick this up automatically by running `create-ampless upgrade` (it overwrites `next.config.mjs` with the template version) and redeploying. To fix a live site before the next upgrade, add the same line manually and redeploy.
