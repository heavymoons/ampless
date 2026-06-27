---
"@ampless/backend": patch
---

Grant the admin/editor groups write access to `public/static/*` in the storage config. Static-bundle posts (`format: 'static'`) upload their files to `public/static/<slug>/...` from the browser admin using Cognito identity-pool credentials, but the `defineStorage` access map only covered `public/media/*` and `public/plugins/*`. Saving a static post therefore failed with `s3:PutObject ... not authorized`. The new rule mirrors the media grant (guest read, admin/editor read/write/delete). Requires a backend redeploy to take effect.
