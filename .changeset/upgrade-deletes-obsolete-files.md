---
"create-ampless": minor
---

`update-ampless` now deletes files from ampless-managed `app/`
subdirectories that no longer exist in the current template. This
fixes the long-standing issue where route shells scaffolded by older
alpha versions linger after the template removes them — most
recently the `/api/mcp` and `/api/admin/mcp-tokens` routes that PR #57
dropped along with the Cognito-service-user HTTP MCP, leaving
projects on alpha.18+ with broken imports against the newer
`@ampless/admin` exports.

Managed paths (where deletion applies):
- `app/(admin)/admin`
- `app/api/admin`
- `app/api/media`
- `app/api/mcp`
- `app/login`
- `app/site`

Anything outside these paths is untouched — user-owned top-level
routes (`app/page.tsx`, custom `app/blog/`, etc.) are safe. Within
managed paths, ampless owns the directory wholesale; user
customisations belong elsewhere.

Empty subdirectories left behind by the deletion are pruned
automatically (bottom-up).
