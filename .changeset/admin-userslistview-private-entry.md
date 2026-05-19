---
"@ampless/admin": patch
---

Fix `next build` "Server Components cannot use Client function" error on
the `/login` route (and any route reachable from `@ampless/admin/pages`).

`UsersListView` is imported only by `src/pages/users-list.tsx`, so tsup
had no incentive to put it in a shared chunk and inlined it directly into
`dist/pages/index.js`. The `preserveDirectives` plugin then saw a
`'use client'` input among the entry's inputs and applied `'use client'`
to the whole entry — making every page factory (`createLoginPage`,
`createDashboardPage`, etc.) a Client function and breaking app router
pages that `import { createLoginPage } from '@ampless/admin/pages'`.

Fixed by adding `src/components/users-list-view.tsx` as a private tsup
entry (mirroring how `src/lib/theme-actions.ts` is split so its
`'use server'` directive survives bundling). This keeps the admin-only
users view out of the public `@ampless/admin/components` barrel while
giving esbuild a reason to emit it as a separate chunk that
`dist/pages/index.js` imports across the server/client boundary cleanly.

Supersedes the earlier alpha that exported `UsersListView` from the
public barrel — that approach worked but widened the public surface
with an admin-only component.
