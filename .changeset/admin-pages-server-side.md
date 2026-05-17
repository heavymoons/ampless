---
"@ampless/admin": patch
---

Move `AdminProviders` to `components/` so `dist/pages` stays server-side.

`c8232a5` (preserve `'use client'` / `'use server'` directives) correctly tagged each output based on its inlined inputs, but `src/pages/` mixed server-side factories (`createAdminLayout`, `createSiteEditPage`, ...) with `'use client'` view modules (`dashboard.tsx`, `posts-list.tsx`, `admin-providers.tsx`, ...). That left `dist/pages/index.js` marked `'use client'`, and Next.js rejected `createAdminLayout(admin)` calls from Server Component shells with:

> Attempted to call createAdminLayout() from the server but createAdminLayout is on the client.

Fix:

1. Move all `'use client'` view components out of `src/pages/` into `src/components/` (`admin-providers.tsx`, `admin-dashboard.tsx`, `posts-list-view.tsx`, `new-post-view.tsx`, `edit-post-view.tsx`, `media-view.tsx`, `login-view.tsx`). The files in `src/pages/` now hold only the server-side factory wrappers (`createAdminDashboardPage`, ...) that import the view across the boundary.
2. Re-export the view components from `@ampless/admin/components` — both as an opt-in escape hatch and to keep tsup from inlining them back into `dist/pages/index.js`.
3. Extract `ADMIN_SITE_COOKIE` into a directive-less `lib/admin-site-cookie.ts` so it can be shared between server-side `lib/admin-site.ts` and client-side `lib/admin-site-client.ts` without pulling the `'use client'` boundary into the locale/i18n chunk that `dist/index.js` consumes.
4. Split `lib/theme-actions.ts` (`'use server'`) into its own tsup entry so it ends up in a dedicated `'use server'`-tagged file instead of getting mixed into the shared client-components chunk.
5. Extend the `preserveDirectives` plugin in `tsup.config.ts` to also tag internal chunks whose inputs are purely `'use client'` (or purely `'use server'`). This is what lets `chunk-*-clients.js` ship a real boundary marker that Next.js can detect when a server-side `pages/index.js` imports a view component from it. Chunks that mix both directives are still left un-tagged with a warning.

The public API of `@ampless/admin/pages` and `@ampless/admin/components` is unchanged — same factory names, same call shape.
