---
"create-ampless": minor
---

`update-ampless` now removes specific files retired between alpha
versions, even when they live outside `AMPLESS_MANAGED_APP_PATHS`.

The retired list is hand-curated (`AMPLESS_RETIRED_PATHS` in
`upgrade.ts`) to avoid the risk of deleting user-authored content
inside top-level dirs like `lib/`. Current entries:

- `lib/admin-site.ts`
- `lib/admin-site-client.ts`

Both were the multi-site cookie / selector shim files left behind
when PR #93 dropped multi-site. Downstream operators previously had
to delete them by hand to make `npm run build` pass.

Files in this list are deleted unconditionally — if you've added
your own code to one of them, move it elsewhere before running
upgrade.
