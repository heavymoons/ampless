---
"@ampless/admin": patch
---

Fix `next build` "Server Components cannot use Client function" error on
the `/login` route (and any other route that imports `createUsersListPage`
indirectly via `@ampless/admin/pages`).

`UsersListView` was missing from `src/components/index.ts`'s barrel. As a
result tsup had no reason to put it in a shared chunk and inlined it
straight into `dist/pages/index.js`. The `preserveDirectives` plugin then
saw a `'use client'` input among the entry's inputs and (correctly)
applied `'use client'` to the whole entry — making every page factory
(`createLoginPage`, `createDashboardPage`, etc.) a Client function. App
Router `app/login/page.tsx` imports `createLoginPage` from a Server
Component context, which Next.js 16 then rejects with:

```
× You're importing a component that imports createLoginPage. It's
  in a client boundary, but no other client component imports it.
```

The other `*-view.tsx` Client components were already in the barrel for
exactly this reason (see the comment in `src/components/index.ts`).
`UsersListView` was added later and slipped through.
